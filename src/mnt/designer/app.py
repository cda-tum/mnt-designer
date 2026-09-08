import argparse
import io
import logging
import os
import re
import secrets
import struct
import tempfile
import uuid
import webbrowser
from collections.abc import Sequence
from contextlib import redirect_stdout
from importlib.metadata import version
from pathlib import Path

from flask import Flask, cli, jsonify, render_template, request, send_file, session
from werkzeug.exceptions import RequestEntityTooLarge

from mnt.pyfiction import (
    a_star,
    apply_bestagon_library,
    apply_qca_one_library,
    cartesian_gate_layout,
    cartesian_obstruction_layout,
    color_mode,
    eq_type,
    equivalence_checking,
    equivalence_checking_stats,
    gate_level_drvs,
    gold_cost_objective,
    gold_effort_mode,
    graph_oriented_layout_design,
    graph_oriented_layout_design_params,
    hexagonalization,
    orthogonal,
    post_layout_optimization,
    post_layout_optimization_params,
    read_cartesian_fgl_layout,
    read_technology_network,
    route_path,
    write_dot_layout,
    write_fgl_layout,
    write_qca_layout_svg,
    write_qca_layout_svg_params,
    write_sidb_layout_svg,
    write_sidb_layout_svg_params,
)

try:
    from mnt.pyfiction import exact_cartesian, exact_params
except (ImportError, AttributeError):
    exact_params = None
    exact_cartesian = None


app = Flask(__name__)
app.secret_key = os.environ.get("MNT_DESIGNER_SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # Entire request, including multipart overhead.

# Layouts and networks are process-local; use a single worker for hosted instances.
layouts = {}

# In-memory storage for user networks
networks = {}

# In-memory storage for user verilog
verilogs = {}


@app.errorhandler(RequestEntityTooLarge)
def request_too_large(_error):
    return jsonify({"success": False, "error": "Request exceeds the upload size limit."}), 413


@app.route("/")
def index():
    # Assign a unique session ID if not already present
    if "session_id" not in session:
        session["session_id"] = str(uuid.uuid4())
    return render_template("index.html")


@app.route("/create_layout", methods=["POST"])
def create_layout():
    try:
        data = request.json
        x = int(data.get("x")) - 1
        y = int(data.get("y")) - 1
        z = 1  # Default Z value
        if x < 0 or y < 0:
            return jsonify({"success": False, "error": "Layout dimensions must be positive."}), 400

        session_id = session["session_id"]
        layout = layouts.get(session_id)

        if layout:
            _, maximum = layout.bounding_box_2d()
            if maximum.x > x or maximum.y > y:
                return jsonify({"success": False, "error": "Layout dimensions would hide existing gates."}), 400

        if not layout:
            # Create a new layout if one doesn't exist
            layout = cartesian_obstruction_layout(cartesian_gate_layout((0, 0, 0), "2DDWave", "Layout"))
            layouts[session_id] = layout

        # Resize the existing layout
        layout.resize((x, y, z))
        return jsonify({"success": True})
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/reset_layout", methods=["POST"])
def reset_layout():
    try:
        data = request.json
        x = int(data.get("x")) - 1
        y = int(data.get("y")) - 1
        z = 1  # Default Z value
        if x < 0 or y < 0:
            return jsonify({"success": False, "error": "Layout dimensions must be positive."}), 400
        layout = cartesian_obstruction_layout(cartesian_gate_layout((x, y, z), "2DDWave", "Layout"))

        session_id = session["session_id"]
        layouts[session_id] = layout

        return jsonify({"success": True})
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/reset_editor", methods=["POST"])
def reset_editor():
    try:
        session_id = session.get("session_id")
        if not session_id:
            return jsonify({"success": False, "error": "Session ID not found."}), 400

        # Define the default Verilog code
        default_verilog_code = ""

        # Reset the editor's code to the default
        verilogs[session_id] = default_verilog_code
        networks[session_id] = None

        return jsonify({"success": True, "code": default_verilog_code}), 200

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def _gate_layer(layout, x, y):
    # The editor projects both native layers onto one tile; an isolated upper wire is still editable.
    return 1 if layout.z() > 0 and layout.is_empty_tile((x, y, 0)) else 0


@app.route("/place_gate", methods=["POST"])
def place_gate():
    try:
        data = request.json
        x = int(data["x"])
        y = int(data["y"])
        gate_type = data["gate_type"]
        params = data["params"]
        update_first = False
        update_second = False

        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        node = layout.get_node((x, y, _gate_layer(layout, x, y)))
        if node != 0:
            return jsonify({"success": False, "error": "Tile already has a gate."})

        if gate_type in ["bufc", "bufk"] and layout.z() == 0:
            layout.resize((layout.x(), layout.y(), 1))

        # Enforce incoming signal constraints
        if gate_type == "pi":
            if params:
                return jsonify({"success": False, "error": "PI gate cannot have inputs."})
            layout.create_pi("", (x, y))
        elif gate_type in ["buf", "inv", "po"]:
            if "first" not in params or "second" in params:
                return jsonify(
                    {
                        "success": False,
                        "error": f"{gate_type.upper()} gate requires exactly one input.",
                    }
                )
            source_x = int(params["first"]["position"]["x"])
            source_y = int(params["first"]["position"]["y"])
            source_z = _gate_layer(layout, source_x, source_y)
            source_gate_type = params["first"]["gate_type"]

            if source_gate_type == "bufc":
                if source_x < x:
                    if layout.has_southern_outgoing_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_southern_outgoing_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                            source_z = 1
                        elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                            source_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif source_y < y:
                    if layout.has_eastern_outgoing_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_eastern_outgoing_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                            source_z = 0
                        elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                            source_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})

            if source_gate_type == "bufk":
                if source_x < x:
                    if layout.has_southern_outgoing_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_southern_outgoing_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                            source_z = 0
                        elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                            source_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif source_y < y:
                    if layout.has_eastern_outgoing_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_eastern_outgoing_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                            source_z = 1
                        elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                            source_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})

            source_node = layout.get_node((source_x, source_y, source_z))
            if not source_node:
                return jsonify({"success": False, "error": "Source gate not found."})

            # Check if the gate already has inputs
            existing_fanins = layout.fanins((x, y))
            if existing_fanins:
                return jsonify(
                    {
                        "success": False,
                        "error": f"Gate at ({x}, {y}) cannot have more than 1 input.",
                    }
                )

            # Determine allowed number of fanouts
            existing_fanouts = layout.fanouts((source_x, source_y, source_z))
            num_fanouts = len(existing_fanouts)

            if layout.is_po(source_node):
                max_fanouts = 0
            elif layout.is_wire(source_node) and not source_z == 1:
                max_fanouts = 2
            else:
                max_fanouts = 1

            if num_fanouts >= max_fanouts:
                return jsonify(
                    {
                        "success": False,
                        "error": f"Gate at ({source_x}, {source_y}, {source_z}) cannot have more than {max_fanouts} outgoing connections.",
                    }
                )

            if gate_type == "po":
                layout.create_po(layout.make_signal(source_node), "", (x, y))
            elif gate_type == "inv":
                layout.create_not(layout.make_signal(source_node), (x, y))
            elif gate_type == "buf":
                layout.create_buf(layout.make_signal(source_node), (x, y))
            if layout.fanout_size(source_node) == 2:
                update_first = True
        elif gate_type in ["and", "or", "nor", "xor", "xnor", "bufc", "bufk"]:
            if "first" not in params or "second" not in params:
                return jsonify(
                    {
                        "success": False,
                        "error": f"{gate_type.upper()} gate requires exactly two inputs.",
                    }
                )
            first_x = int(params["first"]["position"]["x"])
            first_y = int(params["first"]["position"]["y"])
            first_z = _gate_layer(layout, first_x, first_y)
            first_source_gate_type = params["first"]["gate_type"]
            if first_source_gate_type == "bufc":
                if first_x < x:
                    if layout.has_southern_outgoing_signal((first_x, first_y, 0)):
                        first_z = 1
                    elif layout.has_southern_outgoing_signal((first_x, first_y, 1)):
                        first_z = 0
                    else:
                        if layout.has_northern_incoming_signal((first_x, first_y, 0)):
                            first_z = 1
                        elif layout.has_northern_incoming_signal((first_x, first_y, 1)):
                            first_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif first_y < y:
                    if layout.has_eastern_outgoing_signal((first_x, first_y, 0)):
                        first_z = 1
                    elif layout.has_eastern_outgoing_signal((first_x, first_y, 1)):
                        first_z = 0
                    else:
                        if layout.has_northern_incoming_signal((first_x, first_y, 0)):
                            first_z = 0
                        elif layout.has_northern_incoming_signal((first_x, first_y, 1)):
                            first_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})

            if first_source_gate_type == "bufk":
                if first_x < x:
                    if layout.has_southern_outgoing_signal((first_x, first_y, 0)):
                        first_z = 1
                    elif layout.has_southern_outgoing_signal((first_x, first_y, 1)):
                        first_z = 0
                    else:
                        if layout.has_northern_incoming_signal((first_x, first_y, 0)):
                            first_z = 0
                        elif layout.has_northern_incoming_signal((first_x, first_y, 1)):
                            first_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif first_y < y:
                    if layout.has_eastern_outgoing_signal((first_x, first_y, 0)):
                        first_z = 1
                    elif layout.has_eastern_outgoing_signal((first_x, first_y, 1)):
                        first_z = 0
                    else:
                        if layout.has_northern_incoming_signal((first_x, first_y, 0)):
                            first_z = 1
                        elif layout.has_northern_incoming_signal((first_x, first_y, 1)):
                            first_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})
            second_x = int(params["second"]["position"]["x"])
            second_y = int(params["second"]["position"]["y"])
            second_z = _gate_layer(layout, second_x, second_y)
            second_source_gate_type = params["second"]["gate_type"]
            if second_source_gate_type == "bufc":
                if second_x < x:
                    if layout.has_southern_outgoing_signal((second_x, second_y, 0)):
                        second_z = 1
                    elif layout.has_southern_outgoing_signal((second_x, second_y, 1)):
                        second_z = 0
                    else:
                        if layout.has_northern_incoming_signal((second_x, second_y, 0)):
                            second_z = 1
                        elif layout.has_northern_incoming_signal((second_x, second_y, 1)):
                            second_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif second_y < y:
                    if layout.has_eastern_outgoing_signal((second_x, second_y, 0)):
                        second_z = 1
                    elif layout.has_eastern_outgoing_signal((second_x, second_y, 1)):
                        second_z = 0
                    else:
                        if layout.has_northern_incoming_signal((second_x, second_y, 0)):
                            second_z = 0
                        elif layout.has_northern_incoming_signal((second_x, second_y, 1)):
                            second_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})

            if second_source_gate_type == "bufk":
                if second_x < x:
                    if layout.has_southern_outgoing_signal((second_x, second_y, 0)):
                        second_z = 1
                    elif layout.has_southern_outgoing_signal((second_x, second_y, 1)):
                        second_z = 0
                    else:
                        if layout.has_northern_incoming_signal((second_x, second_y, 0)):
                            second_z = 0
                        elif layout.has_northern_incoming_signal((second_x, second_y, 1)):
                            second_z = 1
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                elif second_y < y:
                    if layout.has_eastern_outgoing_signal((second_x, second_y, 0)):
                        second_z = 1
                    elif layout.has_eastern_outgoing_signal((second_x, second_y, 1)):
                        second_z = 0
                    else:
                        if layout.has_northern_incoming_signal((second_x, second_y, 0)):
                            second_z = 1
                        elif layout.has_northern_incoming_signal((second_x, second_y, 1)):
                            second_z = 0
                        else:
                            return jsonify({"success": False, "error": "Something went wrong."})
                else:
                    return jsonify({"success": False, "error": "Something went wrong."})
            first_node = layout.get_node((first_x, first_y, first_z))
            second_node = layout.get_node((second_x, second_y, second_z))
            if not first_node or not second_node:
                return jsonify({"success": False, "error": "One or both source gates not found."})

            # Check if the gate already has inputs
            existing_fanins = layout.fanins((x, y))
            if len(existing_fanins) >= 2:
                return jsonify(
                    {
                        "success": False,
                        "error": f"Gate at ({x}, {y}) cannot have more than 2 inputs.",
                    }
                )

            for existing_fanin in existing_fanins:
                # Determine allowed number of fanouts
                existing_fanouts = layout.fanouts(existing_fanin)
                num_fanouts = len(existing_fanouts)

                if layout.is_po(existing_fanin):
                    max_fanouts = 0
                elif layout.is_wire(existing_fanin) and not existing_fanin.z == 1:
                    max_fanouts = 2
                else:
                    max_fanouts = 1

                if num_fanouts >= max_fanouts:
                    return jsonify(
                        {
                            "success": False,
                            "error": f"Gate at {existing_fanin} cannot have more than {max_fanouts} outgoing connections.",
                        }
                    )

            # Determine allowed number of fanouts
            existing_fanouts_first_node = layout.fanouts((first_x, first_y, first_z))
            num_fanouts_first_node = len(existing_fanouts_first_node)

            if layout.is_po(first_node):
                max_fanouts_first_node = 0
            elif layout.is_wire(first_node) and not first_z == 1:
                max_fanouts_first_node = 2
            else:
                max_fanouts_first_node = 1

            if num_fanouts_first_node >= max_fanouts_first_node:
                return jsonify(
                    {
                        "success": False,
                        "error": f"Gate at ({first_x}, {first_y}, {first_z}) cannot have more than {max_fanouts_first_node} outgoing connections.",
                    }
                )

                # Determine allowed number of fanouts
            existing_fanouts_second_node = layout.fanouts((second_x, second_y, second_z))
            num_fanouts_second_node = len(existing_fanouts_second_node)

            if layout.is_po(second_node):
                max_fanouts_second_node = 0
            elif layout.is_wire(second_node) and not second_z == 1:
                max_fanouts_second_node = 2
            else:
                max_fanouts_second_node = 1

            if num_fanouts_second_node >= max_fanouts_second_node:
                return jsonify(
                    {
                        "success": False,
                        "error": f"Gate at ({second_x}, {second_y}, {second_z}) cannot have more than {max_fanouts_second_node} outgoing connections.",
                    }
                )

            if gate_type == "and":
                layout.create_and(
                    layout.make_signal(first_node),
                    layout.make_signal(second_node),
                    (x, y),
                )
            elif gate_type == "or":
                layout.create_or(
                    layout.make_signal(first_node),
                    layout.make_signal(second_node),
                    (x, y),
                )
            elif gate_type == "nor":
                layout.create_nor(
                    layout.make_signal(first_node),
                    layout.make_signal(second_node),
                    (x, y),
                )
            elif gate_type == "xor":
                layout.create_xor(
                    layout.make_signal(first_node),
                    layout.make_signal(second_node),
                    (x, y),
                )
            elif gate_type == "xnor":
                layout.create_xnor(
                    layout.make_signal(first_node),
                    layout.make_signal(second_node),
                    (x, y),
                )
            elif gate_type in ["bufc", "bufk"]:
                # The upper wire always faces east: west input for straight, north input for bent crossings.
                upper_is_first = first_x < x if gate_type == "bufc" else first_y < y
                lower_node, upper_node = (second_node, first_node) if upper_is_first else (first_node, second_node)
                layout.create_buf(layout.make_signal(lower_node), (x, y, 0))
                layout.create_buf(layout.make_signal(upper_node), (x, y, 1))
                layout.obstruct_coordinate((x, y, 1))
            if layout.fanout_size(first_node) == 2:
                update_first = True
            if layout.fanout_size(second_node) == 2:
                update_second = True
        else:
            return jsonify({"success": False, "error": f"Unsupported gate type: {gate_type}"})

        layout.obstruct_coordinate((x, y, 0))

        return (
            jsonify(
                {
                    "success": True,
                    "updateFirstBufToFanout": update_first,
                    "updateSecondBufToFanout": update_second,
                }
            ),
            200,
        )

    except RequestEntityTooLarge:
        raise
    except Exception as e:
        print(f"Error in place_gate: {e}")
        return jsonify({"success": False, "error": str(e)})


@app.route("/delete_gate", methods=["POST"])
def delete_gate():
    try:
        data = request.json
        x = int(data["x"])
        y = int(data["y"])

        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        found = False
        for z in (1, 0) if layout.z() > 0 else (0,):
            tile = (x, y, z)
            if layout.is_empty_tile(tile):
                continue
            found = True
            outgoing_tiles = layout.fanouts(tile)
            layout.clear_tile(tile)
            layout.clear_obstructed_coordinate(tile)
            for outgoing_tile in outgoing_tiles:
                incoming_tiles = layout.fanins(outgoing_tile)
                incoming_signals = [layout.make_signal(layout.get_node(inp)) for inp in incoming_tiles if inp != tile]
                layout.move_node(layout.get_node(outgoing_tile), outgoing_tile, incoming_signals)

        if found:
            return jsonify({"success": True})
        else:
            return jsonify({"success": False, "error": "Gate not found at the specified position."})
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/connect_gates", methods=["POST"])
def connect_gates():
    try:
        data = request.json
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        source_x = int(data["source_x"])
        source_y = int(data["source_y"])
        source_z = _gate_layer(layout, source_x, source_y)
        source_gate_type = data["source_gate_type"]
        target_x = int(data["target_x"])
        target_y = int(data["target_y"])
        target_z = _gate_layer(layout, target_x, target_y)
        target_gate_type = data["target_gate_type"]
        find_path = data["find_path"]

        if source_gate_type == "bufc":
            if find_path:
                return jsonify(
                    {
                        "success": False,
                        "error": "Source gate is a crossing and the outgoing direction cannot be specified, create a connected buffer first.",
                    }
                )
            if source_x < target_x:
                if layout.has_southern_outgoing_signal((source_x, source_y, 0)):
                    source_z = 1
                elif layout.has_southern_outgoing_signal((source_x, source_y, 1)):
                    source_z = 0
                else:
                    if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        source_z = 0
            elif source_y < target_y:
                if layout.has_eastern_outgoing_signal((source_x, source_y, 0)):
                    source_z = 1
                elif layout.has_eastern_outgoing_signal((source_x, source_y, 1)):
                    source_z = 0
                else:
                    if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                        source_z = 0
                    elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                        source_z = 1
                    else:
                        source_z = 0
            else:
                return jsonify({"success": False, "error": "Something went wrong."})

        if source_gate_type == "bufk":
            if find_path:
                return jsonify(
                    {
                        "success": False,
                        "error": "Source gate is a crossing and the outgoing direction cannot be specified, create a connected buffer first.",
                    }
                )
            if source_x < target_x:
                if layout.has_southern_outgoing_signal((source_x, source_y, 0)):
                    source_z = 1
                elif layout.has_southern_outgoing_signal((source_x, source_y, 1)):
                    source_z = 0
                else:
                    if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                        source_z = 0
                    elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                        source_z = 1
                    else:
                        source_z = 0
            elif source_y < target_y:
                if layout.has_eastern_outgoing_signal((source_x, source_y, 0)):
                    source_z = 1
                elif layout.has_eastern_outgoing_signal((source_x, source_y, 1)):
                    source_z = 0
                else:
                    if layout.has_northern_incoming_signal((source_x, source_y, 0)):
                        source_z = 1
                    elif layout.has_northern_incoming_signal((source_x, source_y, 1)):
                        source_z = 0
                    else:
                        source_z = 0
            else:
                return jsonify({"success": False, "error": "Something went wrong."})

        if target_gate_type == "bufc":
            if find_path:
                return jsonify(
                    {
                        "success": False,
                        "error": "Target gate is a crossing and the incoming direction cannot be specified, create a connected buffer first.",
                    }
                )
            if source_x < target_x:
                if layout.has_southern_outgoing_signal((target_x, target_y, 0)):
                    target_z = 1
                elif layout.has_southern_outgoing_signal((target_x, target_y, 1)):
                    target_z = 0
                else:
                    if layout.has_northern_incoming_signal((target_x, target_y, 0)):
                        target_z = 1
                    elif layout.has_northern_incoming_signal((target_x, target_y, 1)):
                        target_z = 0
                    else:
                        target_z = 0
            elif source_y < target_y:
                if layout.has_eastern_outgoing_signal((target_x, target_y, 0)):
                    target_z = 1
                elif layout.has_eastern_outgoing_signal((target_x, target_y, 1)):
                    target_z = 0
                else:
                    if layout.has_western_incoming_signal((target_x, target_y, 0)):
                        target_z = 1
                    elif layout.has_western_incoming_signal((target_x, target_y, 1)):
                        target_z = 0
                    else:
                        target_z = 0
            else:
                return jsonify({"success": False, "error": "Something went wrong."})

        if target_gate_type == "bufk":
            if find_path:
                return jsonify(
                    {
                        "success": False,
                        "error": "Target gate is a crossing and the incoming direction cannot be specified, create a connected buffer first.",
                    }
                )
            if source_x < target_x:
                if layout.has_southern_outgoing_signal((target_x, target_y, 0)):
                    target_z = 0
                elif layout.has_southern_outgoing_signal((target_x, target_y, 1)):
                    target_z = 1
                else:
                    if layout.has_northern_incoming_signal((target_x, target_y, 0)):
                        target_z = 1
                    elif layout.has_northern_incoming_signal((target_x, target_y, 1)):
                        target_z = 0
                    else:
                        target_z = 0
            elif source_y < target_y:
                if layout.has_eastern_outgoing_signal((target_x, target_y, 0)):
                    target_z = 0
                elif layout.has_eastern_outgoing_signal((target_x, target_y, 1)):
                    target_z = 1
                else:
                    if layout.has_western_incoming_signal((target_x, target_y, 0)):
                        target_z = 1
                    elif layout.has_western_incoming_signal((target_x, target_y, 1)):
                        target_z = 0
                    else:
                        target_z = 0
            else:
                return jsonify({"success": False, "error": "Something went wrong."})

        source_node = layout.get_node((source_x, source_y, source_z))
        target_node = layout.get_node((target_x, target_y, target_z))

        if not source_node:
            return jsonify({"success": False, "error": "Source gate not found."})
        if not target_node:
            return jsonify({"success": False, "error": "Target gate not found."})

        # Determine allowed number of fanouts
        existing_fanouts = layout.fanouts((source_x, source_y, source_z))
        num_fanouts = len(existing_fanouts)

        if layout.is_po(source_node):
            max_fanouts = 0
        elif layout.is_wire(source_node) and not source_z == 1:
            max_fanouts = 2
        else:
            max_fanouts = 1

        if num_fanouts >= max_fanouts:
            return jsonify(
                {
                    "success": False,
                    "error": f"Gate at ({source_x}, {source_y}, {source_z}) cannot have more than {max_fanouts} outgoing connections.",
                }
            )

        # Determine allowed number of fanins
        existing_fanins = layout.fanins((target_x, target_y, target_z))
        num_fanins = len(existing_fanins)

        if layout.is_pi(target_node):
            max_fanins = 0
        elif layout.is_wire(target_node) or layout.is_inv(target_node):
            max_fanins = 1
        else:
            max_fanins = 2

        if num_fanins >= max_fanins:
            return jsonify(
                {
                    "success": False,
                    "error": f"Gate at ({target_x}, {target_y}, {target_z}) cannot have more than {max_fanins} incoming connections.",
                }
            )

        if (source_x, source_y, source_z) in existing_fanins:
            return jsonify(
                {
                    "success": False,
                    "error": f"Gate at ({target_x}, {target_y}, {target_z}) is already connected to ({source_x}, {source_y}, {source_z}.",
                }
            )
        else:
            if not find_path:
                existing_fanins.append((source_x, source_y, source_z))

        incoming_signals = []
        for fanin in existing_fanins:
            incoming_signals.append(layout.make_signal(layout.get_node(fanin)))

        if find_path:
            path = a_star(layout, (source_x, source_y, source_z), (target_x, target_y, target_z))

            if not path:
                return jsonify(
                    {
                        "success": False,
                        "error": "No (crossing-free) path found between the selected gates.",
                    }
                )
        else:
            path = [(source_x, source_y, source_z), (target_x, target_y, target_z)]

        if find_path:
            route_path(layout, path)
        else:
            layout.move_node(target_node, (target_x, target_y, target_z), incoming_signals)

        if layout.fanout_size(source_node) == 2:
            update = True
        else:
            update = False

        if find_path:
            for coord in path:
                layout.obstruct_coordinate(coord)

        return (
            jsonify(
                {
                    "success": True,
                    "updateBufToFanout": update,
                    "path": [(coord.x, coord.y) for coord in path]
                    if data["find_path"]
                    else [(source_x, source_y), (target_x, target_y)],
                }
            ),
            200,
        )
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/move_gate", methods=["POST"])
def move_gate():
    try:
        data = request.json
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        source_x = int(data["source_x"])
        source_y = int(data["source_y"])
        source_gate_type = data["source_gate_type"]
        source_z = _gate_layer(layout, source_x, source_y) if source_gate_type not in ("bufc", "bufk") else 1
        source = (source_x, source_y, source_z)
        target_x = int(data["target_x"])
        target_y = int(data["target_y"])
        target_z = source_z
        target = (target_x, target_y, target_z)

        if not (0 <= target_x <= layout.x() and 0 <= target_y <= layout.y()):
            return jsonify({"success": False, "error": "Target tile is outside the layout."}), 400
        if not layout.is_empty_tile((target_x, target_y, 0)) or not layout.is_empty_tile((target_x, target_y, 1)):
            return jsonify({"success": False, "error": "Target tile already has a gate."}), 400
        if source_gate_type in ("bufc", "bufk") and layout.is_empty_tile((source_x, source_y, 0)):
            return jsonify({"success": False, "error": "Crossing gate is incomplete."}), 400

        source_node = layout.get_node(source)

        if not source_node:
            return jsonify({"success": False, "error": "Source gate not found."})

        # Find all gates that use this node as an input signal
        outgoing_tiles = layout.fanouts(source)

        layout.move_node(source_node, target, [])
        layout.clear_obstructed_coordinate(source)
        layout.obstruct_coordinate(target)

        # Update signals for dependent nodes
        for outgoing_tile in outgoing_tiles:
            # Get the other input signals, if any
            incoming_tiles = layout.fanins(outgoing_tile)
            incoming_signals = [layout.make_signal(layout.get_node(inp)) for inp in incoming_tiles if inp != source]
            layout.move_node(layout.get_node(outgoing_tile), outgoing_tile, incoming_signals)

        if source_gate_type in ("bufc", "bufk"):
            source_z = 0
            source = (source_x, source_y, source_z)
            target_z = 0
            target = (target_x, target_y, target_z)

            source_node = layout.get_node(source)

            if not source_node:
                return jsonify({"success": False, "error": "Source gate not found."})

            # Find all gates that use this node as an input signal
            outgoing_tiles = layout.fanouts(source)
            layout.move_node(source_node, target, [])
            layout.clear_tile(source)
            layout.clear_obstructed_coordinate(source)
            layout.obstruct_coordinate(target)

            # Update signals for dependent nodes
            for outgoing_tile in outgoing_tiles:
                # Get the other input signals, if any
                incoming_tiles = layout.fanins(outgoing_tile)
                incoming_signals = [layout.make_signal(layout.get_node(inp)) for inp in incoming_tiles if inp != source]
                layout.move_node(layout.get_node(outgoing_tile), outgoing_tile, incoming_signals)

        return (
            jsonify(
                {
                    "success": True,
                    "updateGateType": source_gate_type == "fanout",
                }
            ),
            200,
        )
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/check_design_rules", methods=["POST"])
def check_design_rules():
    try:
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        warnings, errors, report = check_design_rules_function(layout)

        return (
            jsonify(
                {
                    "success": True,
                    "errors": errors,
                    "warnings": warnings,
                    "report": report,
                }
            ),
            200,
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


def strip_ansi_codes(text):
    ansi_escape = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
    return ansi_escape.sub("", text)


def format_output(text):
    # Split the text based on the [i] marker
    sections = text.split("[i]")

    # Reconstruct the output with proper line breaks
    formatted = ""
    for section in sections:
        stripped = section.strip()
        if stripped:
            formatted += f"[i] {stripped}\n"
    return formatted


def check_design_rules_function(layout):
    # Create a StringIO object to capture the output
    captured_output = io.StringIO()

    # Redirect stdout to the StringIO object
    with redirect_stdout(captured_output):
        warnings, errors = gate_level_drvs(layout, print_report=True)

    # Retrieve the captured output
    raw_output = captured_output.getvalue()
    clean_output = strip_ansi_codes(raw_output)
    output = format_output(clean_output)
    return warnings, errors, output


@app.route("/check_equivalence", methods=["POST"])
def check_equivalence():
    try:
        session_id = session.get("session_id")
        if not session_id:
            return jsonify({"success": False, "error": "Session not found."}), 400

        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."}), 404

        network = networks.get(session_id)
        if not network:
            return jsonify({"success": False, "error": "Network not found."}), 404

        # Call your design rule checking function
        equivalence, counter_example = check_equivalence_function(layout, network)

        return (
            jsonify(
                {
                    "success": True,
                    "equivalence": equivalence,
                    "counter_example": counter_example,
                }
            ),
            200,
        )

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def check_equivalence_function(layout, network):
    stats = equivalence_checking_stats()
    eq = equivalence_checking(layout, network, stats)

    if eq == eq_type.STRONG:
        equivalence = "STRONG"
        counter_example = None  # No counter example needed
    elif eq == eq_type.WEAK:
        equivalence = "WEAK"
        counter_example = None  # No counter example needed
    else:
        equivalence = "NO"
        counter_example = stats.counter_example
        print(counter_example)

    return equivalence, counter_example


def _send_layout_file(layout, writer, filename, mimetype, *params):
    # Each request owns its files; read the result before the temporary directory is removed.
    with tempfile.TemporaryDirectory(prefix="mnt-designer-") as directory:
        path = Path(directory) / filename
        writer(layout, str(path), *params)
        content = io.BytesIO(path.read_bytes())
    return send_file(content, as_attachment=True, mimetype=mimetype, download_name=filename)


@app.route("/export_layout", methods=["GET"])
def export_layout():
    try:
        session_id = session.get("session_id")
        layout = layouts.get(session_id)

        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        return _send_layout_file(layout, write_fgl_layout, "layout.fgl", "application/fgl")

    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/export_dot_layout", methods=["GET"])
def export_dot_layout():
    try:
        session_id = session.get("session_id")
        layout = layouts.get(session_id)

        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        return _send_layout_file(layout, write_dot_layout, "layout.dot", "application/dot")

    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/export_qca_layout", methods=["GET"])
def export_qca_layout():
    try:
        session_id = session.get("session_id")
        layout = layouts.get(session_id)

        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        cell_level_layout = apply_qca_one_library(layout)
        params = write_qca_layout_svg_params()
        return _send_layout_file(cell_level_layout, write_qca_layout_svg, "layout_qca.svg", "image/svg+xml", params)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/export_sidb_layout", methods=["GET"])
def export_sidb_layout():
    try:
        session_id = session.get("session_id")
        layout = layouts.get(session_id)

        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        hex_layout = hexagonalization(layout)
        cell_level_layout = apply_bestagon_library(hex_layout)

        params = write_sidb_layout_svg_params()
        params.color_background = color_mode.DARK
        return _send_layout_file(cell_level_layout, write_sidb_layout_svg, "layout_sidb.svg", "image/svg+xml", params)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/import_layout", methods=["POST"])
def import_layout():
    try:
        # Get the uploaded file with the key 'file'
        file = request.files.get("file")
        if not file:
            return jsonify({"success": False, "error": "No file provided."})

        with tempfile.TemporaryDirectory(prefix="mnt-designer-") as directory:
            path = Path(directory) / "layout.fgl"
            file.save(path)
            layout = read_cartesian_fgl_layout(str(path))

        # Override the current layout with the imported layout
        session_id = session["session_id"]
        layouts[session_id] = cartesian_obstruction_layout(layout)

        return jsonify({"success": True})

    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/get_layout", methods=["GET"])
def get_layout():
    try:
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": False, "error": "Layout not found."})

        # Extract layout data
        layout_dimensions, gates = get_layout_information(layout)
        return jsonify({"success": True, "layoutDimensions": layout_dimensions, "gates": gates})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/get_bounding_box", methods=["GET"])
def get_bounding_box():
    try:
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({"success": True, "max_x": 0, "max_y": 0})

        # Extract layout data
        _, max_coord = layout.bounding_box_2d()
        return jsonify({"success": True, "max_x": max_coord.x, "max_y": max_coord.y})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/get_verilog_code", methods=["GET"])
def get_verilog_code():
    try:
        # Ensure the user has a session_id
        if "session_id" not in session:
            return jsonify({"success": False, "error": "Session not found."}), 400

        session_id = session["session_id"]

        # Retrieve the Verilog code for the current session
        code = verilogs.get(session_id)

        if code is None:
            return jsonify({"success": False, "error": "Verilog code not found."})

        # Return the Verilog code
        return jsonify({"success": True, "code": code}), 200

    except Exception as e:
        # Handle unexpected errors
        return jsonify({"success": False, "error": str(e)}), 500


def _read_verilog(code):
    with tempfile.TemporaryDirectory(prefix="mnt-designer-") as directory:
        path = Path(directory) / "network.v"
        path.write_text(code, encoding="utf-8")
        return read_technology_network(str(path))


@app.route("/save_verilog_code", methods=["POST"])
def save_verilog_code():
    try:
        data = request.json
        code = data.get("code", "")

        network = _read_verilog(code)

        session_id = session["session_id"]
        networks[session_id] = network
        verilogs[session_id] = code

        return jsonify({"success": True})
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/import_verilog_code", methods=["POST"])
def import_verilog_code():
    try:
        # Get the uploaded file with the key 'file'
        uploaded_file = request.files.get("file")
        if not uploaded_file:
            return jsonify({"success": False, "error": "No file provided."})

        # Read the file content
        code = uploaded_file.read().decode("utf-8")

        network = _read_verilog(code)

        # Store the network in the session
        session_id = session["session_id"]
        networks[session_id] = network
        verilogs[session_id] = code

        # Return the code to be displayed in the editor
        return jsonify({"success": True, "code": code})

    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/apply_orthogonal", methods=["POST"])
def apply_orthogonal():
    try:
        session_id = session["session_id"]
        network = networks.get(session_id)
        if not network:
            return jsonify(
                {
                    "success": False,
                    "error": "Network not found. Please save or import Verilog code first.",
                }
            )

        if network.size() < 3:
            return jsonify(
                {
                    "success": False,
                    "error": "Network size is less than 3, indicating that not gates are present.",
                }
            )

        if network.size() > 500:
            return jsonify(
                {
                    "success": False,
                    "error": "Network size exceeds 500 nodes and the resulting layout can not be rendered.",
                }
            )

        for po in network.pos():
            for fanin in network.fanins(po):
                if fanin in (0, 1):
                    return jsonify(
                        {
                            "success": False,
                            "error": f"Network has an unconnected PO: {network.get_output_name(network.po_index(po))}.",
                        }
                    )

        try:
            # Apply the orthogonal function
            layout = orthogonal(network)
        except Exception as e:
            return jsonify({"success": False, "error": str(e)})

        layouts[session_id] = cartesian_obstruction_layout(layout)  # Update the layout in the session

        layout_dimensions, gates = get_layout_information(layout)

        return jsonify({"success": True, "layoutDimensions": layout_dimensions, "gates": gates})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/apply_iosdn", methods=["POST"])
def apply_iosdn():
    try:
        session_id = session["session_id"]
        network = networks.get(session_id)
        if not network:
            return jsonify(
                {
                    "success": False,
                    "error": "Network not found. Please save or import Verilog code first.",
                }
            )

        if network.size() < 3:
            return jsonify(
                {
                    "success": False,
                    "error": "Network size is less than 3, indicating that not gates are present.",
                }
            )

        if network.size() > 500:
            return jsonify(
                {
                    "success": False,
                    "error": "Network size exceeds 500 nodes and the resulting layout can not be rendered.",
                }
            )

        for po in network.pos():
            for fanin in network.fanins(po):
                if fanin in (0, 1):
                    return jsonify(
                        {
                            "success": False,
                            "error": f"Network has an unconnected PO: {network.get_output_name(network.po_index(po))}.",
                        }
                    )

        return jsonify({"success": False, "error": "Input-ordering SDN not available in pyfiction yet."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/apply_gold", methods=["POST"])
def apply_gold():
    try:
        session_id = session["session_id"]
        network = networks.get(session_id)
        if not network:
            return jsonify(
                {
                    "success": False,
                    "error": "Network not found. Please save or import Verilog code first.",
                }
            )

        if network.size() < 3:
            return jsonify(
                {
                    "success": False,
                    "error": "Network is empty.",
                }
            )

        if network.size() > 150:
            return jsonify({"success": False, "error": "Network size exceeds 150 nodes."})

        for po in network.pos():
            for fanin in network.fanins(po):
                if fanin in (0, 1):
                    return jsonify(
                        {
                            "success": False,
                            "error": f"Network has an unconnected PO: {network.get_output_name(network.po_index(po))}.",
                        }
                    )

        # Parameters
        data = request.json
        params = graph_oriented_layout_design_params()
        params.return_first = bool(data.get("return_first"))

        mode = data.get("mode")
        if mode == "HIGH_EFFICIENCY":
            params.mode = gold_effort_mode.HIGH_EFFICIENCY
        elif mode == "HIGH_EFFORT":
            params.mode = gold_effort_mode.HIGH_EFFORT
        elif mode == "HIGHEST_EFFORT":
            params.mode = gold_effort_mode.HIGHEST_EFFORT
        else:
            return jsonify({"success": False, "error": f"Unknown mode: {mode}."})

        params.timeout = int(data.get("timeout"))
        params.num_vertex_expansions = int(data.get("num_vertex_expansions"))
        params.planar = bool(data.get("planar"))
        params.enable_multithreading = bool(data.get("enable_multithreading", params.enable_multithreading))

        cost = data.get("cost")
        if cost == "AREA":
            params.cost = gold_cost_objective.AREA
        elif cost == "WIRES":
            params.cost = gold_cost_objective.WIRES
        elif cost == "CROSSINGS":
            params.cost = gold_cost_objective.CROSSINGS
        elif cost == "ACP":
            params.cost = gold_cost_objective.ACP
        else:
            return jsonify({"success": False, "error": f"Unknown cost objective: {cost}."})

        layout = graph_oriented_layout_design(network, params)
        if layout:
            layouts[session_id] = cartesian_obstruction_layout(layout)  # Update the layout in the session
            layout_dimensions, gates = get_layout_information(layout)

            return jsonify({"success": True, "layoutDimensions": layout_dimensions, "gates": gates})
        else:
            return jsonify(
                {
                    "success": False,
                    "error": "No layout found with the specified parameters.",
                }
            )
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/apply_exact", methods=["POST"])
def apply_exact():
    try:
        session_id = session["session_id"]
        network = networks.get(session_id)
        if not network:
            return jsonify(
                {
                    "success": False,
                    "error": "Network not found. Please save or import Verilog code first.",
                }
            )

        if network.size() < 3:
            return jsonify(
                {
                    "success": False,
                    "error": "Network is empty.",
                }
            )

        if network.size() > 30:
            return jsonify({"success": False, "error": "Network size exceeds 30 nodes."})

        for po in network.pos():
            for fanin in network.fanins(po):
                if fanin in (0, 1):
                    return jsonify(
                        {
                            "success": False,
                            "error": f"Network has an unconnected PO: {network.get_output_name(network.po_index(po))}.",
                        }
                    )

        if exact_params is None or exact_cartesian is None:
            return jsonify(
                {
                    "success": False,
                    "error": "Pyfiction was installed without Z3 enabled.",
                }
            )
        # Parameters
        data = request.json
        if not isinstance(data, dict):
            return jsonify({"success": False, "error": "Exact parameters must be a JSON object."}), 400
        params = exact_params()
        params.scheme = "2DDWave"
        # Match the native uint16_t bounds, size_t thread count, and unsigned timeout.
        limits = {
            "upper_bound_x": 65535,
            "upper_bound_y": 65535,
            "num_threads": (1 << (8 * struct.calcsize("P"))) - 1,
            "timeout": 4294967295,
        }
        for name, maximum in limits.items():
            value = data.get(name, getattr(params, name))
            if type(value) is not int or not 1 <= value <= maximum:
                return jsonify({"success": False, "error": f"{name} must be an integer between 1 and {maximum}."}), 400
            setattr(params, name, value)
        params.fixed_size = bool(data.get("fixed_size", False))
        params.crossings = bool(data.get("crossings", True))
        params.border_io = bool(data.get("border_io", True))
        params.straight_inverters = bool(data.get("straight_inverters", False))
        params.desynchronize = bool(data.get("desynchronize", True))
        params.minimize_wires = bool(data.get("minimize_wires", False))
        params.minimize_crossings = bool(data.get("minimize_crossings", False))
        # Now run the exact algorithm
        layout = exact_cartesian(network, params)
        if layout:
            layouts[session_id] = cartesian_obstruction_layout(layout)
            layout_dimensions, gates = get_layout_information(layout)

            return jsonify({"success": True, "layoutDimensions": layout_dimensions, "gates": gates})
        else:
            return jsonify(
                {
                    "success": False,
                    "error": "No layout found with the specified parameters.",
                }
            )
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/apply_optimization", methods=["POST"])
def apply_optimization():
    try:
        session_id = session["session_id"]
        layout = layouts.get(session_id)
        params = post_layout_optimization_params()

        if not layout:
            return jsonify(
                {
                    "success": False,
                    "error": "Layout not found. Please create a layout first",
                }
            )

        warnings, errors, report = check_design_rules_function(layout)
        if errors != 0:
            return jsonify(
                {
                    "success": False,
                    "error": f"Layout has {errors} errors. Fix them first before optimizing.",
                }
            )
        if warnings != 0:
            for x in range(layout.x() + 1):
                for y in range(layout.y() + 1):
                    for z in range(layout.z() + 1):
                        if not layout.is_empty_tile((x, y, z)) and layout.is_dead(layout.get_node((x, y, z))):
                            return jsonify(
                                {
                                    "success": False,
                                    "error": f"Layout has a dead node: ({x}, {y}, {z}). Fix it first before optimizing.",
                                }
                            )

        data = request.json
        max_gate_relocations = data.get("max_gate_relocations")
        if max_gate_relocations is not None:
            params.max_gate_relocations = int(max_gate_relocations)

        params.optimize_pos_only = bool(data.get("optimize_pos_only"))
        params.planar_optimization = bool(data.get("planar_optimization"))

        params.timeout = int(data.get("timeout"))

        post_layout_optimization(layout, params)
        layouts[session_id] = layout  # Update the layout in the session

        layout_dimensions, gates = get_layout_information(layout)

        return jsonify({"success": True, "layoutDimensions": layout_dimensions, "gates": gates})
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


def _crossing_type(layout, x, y):
    # Connected native/FGL layouts may use either layer order; actual wiring takes precedence.
    for z in (0, 1):
        incoming = layout.fanins((x, y, z))
        outgoing = layout.fanouts((x, y, z))
        if incoming and outgoing:
            return "bufc" if incoming[0].x == outgoing[0].x or incoming[0].y == outgoing[0].y else "bufk"

    # Input-only crossings created here encode intent in their east-facing upper wire.
    for z in (1, 0):
        incoming = layout.fanins((x, y, z))
        if incoming:
            straight = incoming[0].x < x if z == 1 else incoming[0].y < y
            return "bufc" if straight else "bufk"
    # Fully disconnected crossings have no routing intent in native/FGL data. Foreign partial
    # layouts may also use a different layer convention; their original intent cannot be recovered.
    return "bufk"


def get_layout_information(layout):
    layout_dimensions = {"x": layout.x() + 1, "y": layout.y() + 1}
    gates = []

    for x in range(layout.x() + 1):
        for y in range(layout.y() + 1):
            z = _gate_layer(layout, x, y)
            node = layout.get_node((x, y, z))
            name = ""
            if node:
                if layout.is_pi(node):
                    gate_type = "pi"
                    try:
                        name = layout.get_name(layout.make_signal(node))
                    except Exception:
                        name = ""
                elif layout.is_po(node):
                    gate_type = "po"
                    try:
                        name = layout.get_name(layout.make_signal(node))
                    except Exception:
                        name = ""
                elif layout.is_wire(node):
                    gate_type = "buf"
                    above_gate = layout.above(layout.get_tile(node))
                    if z == 0 and layout.z() == 1 and not layout.is_empty_tile(above_gate):
                        gate_type = _crossing_type(layout, x, y)
                    if layout.fanout_size(node) == 2:
                        gate_type = "fanout"
                elif layout.is_inv(node):
                    gate_type = "inv"
                elif layout.is_and(node):
                    gate_type = "and"
                elif layout.is_nand(node):
                    gate_type = "nand"
                elif layout.is_or(node):
                    gate_type = "or"
                elif layout.is_nor(node):
                    gate_type = "nor"
                elif layout.is_xor(node):
                    gate_type = "xor"
                elif layout.is_xnor(node):
                    gate_type = "xnor"
                else:
                    raise Exception("Unsupported gate type")

                gate_info = {
                    "x": x,
                    "y": y,
                    "type": gate_type,
                    "connections": [],
                    "name": name,
                }
                # Get fanins (source nodes)
                fanins = layout.fanins((x, y, z))
                for fin in fanins:
                    gate_info["connections"].append({"sourceX": fin.x, "sourceY": fin.y})
                if gate_type in ("bufc", "bufk"):
                    fanins = layout.fanins((x, y, 1))
                    for fin in fanins:
                        gate_info["connections"].append({"sourceX": fin.x, "sourceY": fin.y})
                gates.append(gate_info)
    return layout_dimensions, gates


def start_server(host: str = "127.0.0.1", port: int = 5001, open_browser: bool = True) -> None:
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    url_host = f"[{host}]" if ":" in host else host
    url = f"http://{url_host}:{port}"
    print(
        f"Server is hosted at: {url}.",
        "To stop it, interrupt the process (e.g., via CTRL+C). \n",
    )
    cli.show_server_banner = lambda *_args: None
    if open_browser:
        webbrowser.open(url)
    app.run(debug=False, host=host, port=port)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Start the MNT Designer web interface.")
    parser.add_argument("--host", default="127.0.0.1", help="Address to bind to (default: 127.0.0.1).")
    parser.add_argument("--port", type=int, default=5001, help="Port to listen on (default: 5001).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {version('mnt.designer')}")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    start_server(host=args.host, port=args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
