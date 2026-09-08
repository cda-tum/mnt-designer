"""Small end-to-end checks against the installed pyfiction bindings."""

import io
import struct
from importlib.metadata import version
from xml.etree import ElementTree

import pytest

from mnt.designer import app as designer

VERILOG = """module top(a, b, y);
input a, b;
output y;
assign y = a & b;
endmodule
"""
EXPORTS = {
    "/export_layout": "layout.fgl",
    "/export_dot_layout": "layout.dot",
    "/export_qca_layout": "layout_qca.svg",
    "/export_sidb_layout": "layout_sidb.svg",
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setitem(designer.app.config, "TESTING", True)
    for name in ("layouts", "networks", "verilogs"):
        monkeypatch.setattr(designer, name, {})
    with designer.app.test_client() as client:
        assert client.get("/").status_code == 200
        yield client


def post(client, route, payload=None, *, success=True):
    response = client.post(route, json=payload or {})
    assert response.is_json, response.get_data(as_text=True)
    result = response.get_json()
    assert result["success"] is success, result
    return result


def test_unexpected_errors_are_logged_without_leaking(client, monkeypatch, caplog):
    detail = "sensitive implementation detail"

    class FailingStore:
        @staticmethod
        def get(_key):
            raise RuntimeError(detail)

    monkeypatch.setattr(designer, "verilogs", FailingStore())
    with caplog.at_level("ERROR", logger=designer.app.logger.name):
        response = client.get("/get_verilog_code")

    assert response.status_code == 500
    assert response.get_json() == {"success": False, "error": "An internal error occurred."}
    assert detail not in response.get_data(as_text=True)
    assert detail in caplog.text


@pytest.fixture
def placed(client):
    post(client, "/save_verilog_code", {"code": VERILOG})
    post(client, "/apply_orthogonal")
    return client


def test_design_workflow(placed):
    layout = placed.get("/get_layout").get_json()
    assert layout["success"]
    assert {gate["type"] for gate in layout["gates"]} >= {"pi", "and", "po"}
    assert placed.get("/get_verilog_code").get_json()["code"] == VERILOG
    assert post(placed, "/check_design_rules")["errors"] == 0
    assert post(placed, "/check_equivalence")["equivalence"] in {"STRONG", "WEAK"}
    optimized = post(
        placed,
        "/apply_optimization",
        {"timeout": 1000, "max_gate_relocations": 1, "optimize_pos_only": False, "planar_optimization": True},
    )
    assert optimized["gates"]
    assert post(placed, "/check_equivalence")["equivalence"] in {"STRONG", "WEAK"}


def test_exports_and_fgl_roundtrip(placed, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    original = placed.get("/get_layout").get_json()
    exports = {}
    for route, filename in EXPORTS.items():
        response = placed.get(route)
        assert response.status_code == 200
        assert filename in response.headers["Content-Disposition"]
        assert response.data
        exports[route] = response.data
        if filename.endswith(".svg"):
            assert response.mimetype == "image/svg+xml"
            assert ElementTree.fromstring(response.data).tag.endswith("svg")
    assert not list(tmp_path.iterdir())
    post(placed, "/reset_layout", {"x": 2, "y": 2})
    imported = placed.post("/import_layout", data={"file": (io.BytesIO(exports["/export_layout"]), "example.fgl")})
    assert imported.get_json()["success"]
    assert placed.get("/get_layout").get_json() == original


def test_missing_layout_exports_and_session_isolation(placed):
    other = designer.app.test_client()
    assert other.get("/").status_code == 200
    for route in EXPORTS:
        response = other.get(route)
        assert response.status_code < 500
        assert response.is_json and response.get_json()["success"] is False
    assert other.get("/get_verilog_code").get_json()["success"] is False
    post(other, "/reset_layout", {"x": 2, "y": 3})
    assert other.get("/get_layout").get_json()["gates"] == []
    assert placed.get("/get_layout").get_json()["gates"]
    assert designer.app.secret_key != "your_secret_key"


@pytest.mark.parametrize(
    "route,extra_file",
    [
        ("/import_layout", False),
        ("/import_verilog_code", False),
        ("/save_verilog_code", False),
        ("/import_verilog_code", True),
    ],
)
def test_oversized_uploads_rejected_before_parsing(placed, monkeypatch, route, extra_file):
    original = placed.get("/get_layout").get_json()
    assert designer.app.config["MAX_CONTENT_LENGTH"] == 5 * 1024 * 1024
    monkeypatch.setitem(designer.app.config, "MAX_CONTENT_LENGTH", 1024)

    def unexpected_parse(*args, **kwargs):
        pytest.fail("Oversized requests must be rejected before file streams or native parsing")

    monkeypatch.setattr(designer.app.request_class, "_get_file_stream", unexpected_parse)
    monkeypatch.setattr(designer, "read_cartesian_fgl_layout", unexpected_parse)
    monkeypatch.setattr(designer, "read_technology_network", unexpected_parse)
    if route == "/save_verilog_code":
        response = placed.post(route, json={"code": "x" * 2048})
    else:
        filename = "example.fgl" if route == "/import_layout" else "example.v"
        data = {"file": (io.BytesIO(VERILOG.encode() if extra_file else b"x" * 2048), filename)}
        if extra_file:
            data["ignored"] = (io.BytesIO(b"x" * 2048), "unused.bin")
        response = placed.post(route, data=data)
    assert response.status_code == 413
    assert response.is_json
    assert response.get_json()["success"] is False
    assert response.get_json()["error"]
    assert placed.get("/get_layout").get_json() == original
    assert placed.get("/get_verilog_code").get_json()["code"] == VERILOG


def test_import_verilog_and_safe_layout_edits(client):
    imported = client.post("/import_verilog_code", data={"file": (io.BytesIO(VERILOG.encode()), "example.v")})
    assert imported.get_json() == {"success": True, "code": VERILOG}
    post(client, "/create_layout", {"x": 3, "y": 3})
    for x, y in ((0, 0), (2, 2)):
        post(client, "/place_gate", {"x": x, "y": y, "gate_type": "pi", "params": {}})
    original = client.get("/get_layout").get_json()
    post(client, "/create_layout", {"x": 2, "y": 2}, success=False)
    for route in ("/create_layout", "/reset_layout"):
        post(client, route, {"x": 0, "y": 3}, success=False)
    post(
        client,
        "/move_gate",
        {"source_x": 0, "source_y": 0, "source_gate_type": "pi", "target_x": 2, "target_y": 2},
        success=False,
    )
    assert client.get("/get_layout").get_json() == original
    post(
        client,
        "/move_gate",
        {"source_x": 0, "source_y": 0, "source_gate_type": "pi", "target_x": 1, "target_y": 0},
    )
    post(client, "/delete_gate", {"x": 1, "y": 0})
    assert len(client.get("/get_layout").get_json()["gates"]) == 1


@pytest.mark.parametrize("gate_type", ["bufc", "bufk"])
@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("consumer", ["po", "and"])
def test_partial_crossing_roundtrip_preserves_routing(client, gate_type, reverse, consumer):
    post(client, "/create_layout", {"x": 4, "y": 4})
    inputs = [(0, 1), (1, 0)]
    for x, y in inputs:
        post(client, "/place_gate", {"x": x, "y": y, "gate_type": "pi", "params": {}})
    if reverse:
        inputs.reverse()
    post(
        client,
        "/place_gate",
        {
            "x": 1,
            "y": 1,
            "gate_type": gate_type,
            "params": {
                key: {"position": {"x": x, "y": y}, "gate_type": "pi"}
                for key, (x, y) in zip(("first", "second"), inputs, strict=True)
            },
        },
    )

    def crossing_type():
        gates = client.get("/get_layout").get_json()["gates"]
        return next(gate["type"] for gate in gates if (gate["x"], gate["y"]) == (1, 1))

    def import_fgl(content):
        post(client, "/reset_layout", {"x": 1, "y": 1})
        response = client.post("/import_layout", data={"file": (io.BytesIO(content), "crossing.fgl")})
        assert response.get_json()["success"], response.get_json()
        assert crossing_type() == gate_type

    assert crossing_type() == gate_type
    assert client.get("/").status_code == 200  # Reload before either output exists.
    assert crossing_type() == gate_type

    for index, (x, y) in enumerate(((2, 1), (1, 2))):
        params = {"first": {"position": {"x": 1, "y": 1}, "gate_type": crossing_type()}}
        if consumer == "and":
            aux_x, aux_y = (2, 0) if index == 0 else (0, 2)
            post(client, "/place_gate", {"x": aux_x, "y": aux_y, "gate_type": "pi", "params": {}})
            params["second"] = {"position": {"x": aux_x, "y": aux_y}, "gate_type": "pi"}
            if index == 1:  # Crossing consumers must work in either input slot.
                params["first"], params["second"] = params["second"], params["first"]
        post(client, "/place_gate", {"x": x, "y": y, "gate_type": consumer, "params": params})
        assert crossing_type() == gate_type  # Also check the one-output state.
        if consumer == "and":
            post(
                client,
                "/place_gate",
                {
                    "x": 3 if index == 0 else 1,
                    "y": 1 if index == 0 else 3,
                    "gate_type": "po",
                    "params": {"first": {"position": {"x": x, "y": y}, "gate_type": "and"}},
                },
            )

    completed = client.get("/export_layout").data
    # Native FGL export omits dangling gates, but imported FGL can explicitly contain them.
    partial = ElementTree.fromstring(completed)
    gates = partial.find("gates")
    for gate in list(gates):
        if gate.findtext("type") != "PI" and (gate.findtext("loc/x"), gate.findtext("loc/y")) != ("1", "1"):
            gates.remove(gate)
    import_fgl(ElementTree.tostring(partial))
    for swapped_layers in (False, True):
        content = ElementTree.fromstring(completed)
        if swapped_layers:  # Complete external FGL crossings can use the opposite layer convention.
            for element in [*content.findall(".//loc"), *content.findall(".//signal")]:
                if (element.findtext("x"), element.findtext("y")) == ("1", "1"):
                    element.find("z").text = str(1 - int(element.findtext("z")))
        import_fgl(ElementTree.tostring(content))
        with client.session_transaction() as session:
            layout = designer.layouts[session["session_id"]]
        expected = [(0, 1), (1, 0)] if gate_type == "bufc" else [(1, 0), (0, 1)]
        for target, origin in zip(((2, 1), (1, 2)), expected, strict=True):
            wire = next(tile for tile in layout.fanins(target) if (tile.x, tile.y) == (1, 1))
            source = layout.fanins(wire)[0]
            assert (source.x, source.y) == origin


def test_move_crossing_preserves_native_layer_order(client):
    layout = designer.cartesian_obstruction_layout(designer.cartesian_gate_layout((3, 3, 1), "2DDWave", "Layout"))
    for z in (0, 1):
        layout.create_buf(layout.create_pi("", (z, 0)), (1, 1, z))
    nodes = [layout.get_node((1, 1, z)) for z in (0, 1)]
    with client.session_transaction() as session:
        designer.layouts[session["session_id"]] = layout
    post(
        client,
        "/move_gate",
        {
            "source_x": 1,
            "source_y": 1,
            "source_gate_type": "bufc",
            "target_x": 0,
            "target_y": 0,
        },
        success=False,
    )
    assert [layout.get_node((1, 1, z)) for z in (0, 1)] == nodes
    post(client, "/move_gate", {"source_x": 1, "source_y": 1, "source_gate_type": "bufc", "target_x": 2, "target_y": 2})
    assert [layout.get_node((2, 2, z)) for z in (0, 1)] == nodes
    assert not layout.fanins((2, 2, 0)) and not layout.fanins((2, 2, 1))
    assert client.get("/get_layout").get_json()["success"]


def test_upper_only_wire_roundtrip_move_connect_and_delete(client):
    layout = designer.cartesian_obstruction_layout(designer.cartesian_gate_layout((3, 2, 1), "2DDWave", "Layout"))
    layout.create_pi("a", (0, 0))
    wire = layout.create_buf(layout.create_pi("b", (0, 1)), (1, 1, 1))
    layout.create_po(wire, "y", (2, 1))
    with client.session_transaction() as session:
        session_id = session["session_id"]
        designer.layouts[session_id] = layout
    original = client.get("/get_layout").get_json()
    upper = next(gate for gate in original["gates"] if (gate["x"], gate["y"]) == (1, 1))
    assert upper["type"] == "buf" and upper["connections"] == [{"sourceX": 0, "sourceY": 1}]
    content = client.get("/export_layout").data
    response = client.post("/import_layout", data={"file": (io.BytesIO(content), "upper.fgl")})
    assert response.get_json()["success"]
    assert client.get("/get_layout").get_json() == original
    layout = designer.layouts[session_id]
    wire_node = layout.get_node((1, 1, 1))
    post(client, "/place_gate", {"x": 1, "y": 1, "gate_type": "pi", "params": {}}, success=False)
    assert client.get("/get_layout").get_json() == original
    post(
        client,
        "/move_gate",
        {
            "source_x": 1,
            "source_y": 1,
            "source_gate_type": "buf",
            "target_x": 1,
            "target_y": 0,
        },
    )
    assert layout.get_node((1, 0, 1)) == wire_node and layout.is_empty_tile((1, 0, 0))
    assert not layout.fanins((2, 1))
    post(
        client,
        "/connect_gates",
        {
            "source_x": 0,
            "source_y": 0,
            "source_gate_type": "pi",
            "target_x": 1,
            "target_y": 0,
            "target_gate_type": "buf",
            "find_path": False,
        },
    )
    assert [(tile.x, tile.y, tile.z) for tile in layout.fanins((1, 0, 1))] == [(0, 0, 0)]
    post(
        client,
        "/move_gate",
        {
            "source_x": 2,
            "source_y": 1,
            "source_gate_type": "po",
            "target_x": 2,
            "target_y": 0,
        },
    )
    post(
        client,
        "/connect_gates",
        {
            "source_x": 1,
            "source_y": 0,
            "source_gate_type": "buf",
            "target_x": 2,
            "target_y": 0,
            "target_gate_type": "po",
            "find_path": False,
        },
    )
    assert [(tile.x, tile.y, tile.z) for tile in layout.fanins((2, 0))] == [(1, 0, 1)]
    post(client, "/delete_gate", {"x": 1, "y": 0})
    assert layout.is_empty_tile((1, 0, 1)) and not layout.fanins((2, 0))
    assert layout.is_pi(layout.get_node((0, 0))) and layout.is_pi(layout.get_node((0, 1)))
    assert len(client.get("/get_layout").get_json()["gates"]) == 3


@pytest.mark.parametrize("consumer,upper_key", [("buf", "first"), ("and", "first"), ("and", "second")])
def test_upper_only_wire_feeds_new_consumers(client, consumer, upper_key):
    layout = designer.cartesian_obstruction_layout(designer.cartesian_gate_layout((2, 2, 1), "2DDWave", "Layout"))
    layout.create_buf(layout.create_pi("a", (0, 1)), (1, 1, 1))
    layout.create_pi("b", (2, 0))
    with client.session_transaction() as session:
        designer.layouts[session["session_id"]] = layout
    params = {upper_key: {"position": {"x": 1, "y": 1}, "gate_type": "buf"}}
    if consumer == "and":
        params["second" if upper_key == "first" else "first"] = {
            "position": {"x": 2, "y": 0},
            "gate_type": "pi",
        }
    post(client, "/place_gate", {"x": 2, "y": 1, "gate_type": consumer, "params": params})
    assert (1, 1, 1) in [(tile.x, tile.y, tile.z) for tile in layout.fanins((2, 1))]
    original = client.get("/get_layout").get_json()
    post(
        client,
        "/place_gate",
        {
            "x": 1,
            "y": 2,
            "gate_type": "buf",
            "params": {"first": {"position": {"x": 1, "y": 1}, "gate_type": "buf"}},
        },
        success=False,
    )  # Upper routing-layer wires still cannot become fanouts.
    assert client.get("/get_layout").get_json() == original


@pytest.mark.parametrize("multithreading", [False, True])
def test_gold_forwards_multithreading(placed, monkeypatch, multithreading):
    run_gold = designer.graph_oriented_layout_design

    def capture(network, params):
        assert params.enable_multithreading is multithreading
        return run_gold(network, params)

    monkeypatch.setattr(designer, "graph_oriented_layout_design", capture)
    result = post(
        placed,
        "/apply_gold",
        {
            "return_first": True,
            "mode": "HIGH_EFFICIENCY",
            "timeout": 1000,
            "num_vertex_expansions": 1,
            "planar": True,
            "cost": "AREA",
            "enable_multithreading": multithreading,
        },
    )
    assert result["gates"]


def test_zero_relocations_is_forwarded(placed, monkeypatch):
    def capture(layout, params):
        assert params.max_gate_relocations == 0

    monkeypatch.setattr(designer, "post_layout_optimization", capture)
    post(placed, "/apply_optimization", {"timeout": 1000, "max_gate_relocations": 0})


def test_exact_defaults_and_unavailable_solver(placed, monkeypatch):
    if designer.exact_params is not None:
        defaults = designer.exact_params()

        def capture(network, params):
            assert params.upper_bound_x == defaults.upper_bound_x
            assert params.upper_bound_y == defaults.upper_bound_y
            return designer.orthogonal(network)

        monkeypatch.setattr(designer, "exact_cartesian", capture)
        assert post(placed, "/apply_exact", {"timeout": 1000})["gates"]
        response = placed.post("/apply_exact", json=[1])
        assert response.status_code == 400
        assert "JSON object" in response.get_json()["error"]
    monkeypatch.setattr(designer, "exact_params", None)
    monkeypatch.setattr(designer, "exact_cartesian", None)
    assert "Z3" in post(placed, "/apply_exact", success=False)["error"]


@pytest.mark.parametrize(
    "field,maximum",
    [
        ("upper_bound_x", 65535),
        ("upper_bound_y", 65535),
        ("num_threads", (1 << (8 * struct.calcsize("P"))) - 1),
        ("timeout", 4294967295),
    ],
)
def test_exact_requires_positive_native_range_integers(placed, monkeypatch, field, maximum):
    if designer.exact_params is None:
        pytest.skip("Pyfiction was built without Exact parameters")
    original = placed.get("/get_layout").get_json()

    def capture(network, params):
        assert getattr(params, field) == maximum
        return designer.orthogonal(network)

    monkeypatch.setattr(designer, "exact_cartesian", capture)
    for invalid in (0, -1, True, False, 1.5, 1.0, "1", None, maximum + 1):
        response = placed.post("/apply_exact", json={field: invalid})
        assert response.status_code == 400, (field, invalid, response.get_json())
        assert response.get_json()["success"] is False
        assert field in response.get_json()["error"]
        assert placed.get("/get_layout").get_json() == original
    assert post(placed, "/apply_exact", {field: maximum})["gates"]


def test_cli(monkeypatch, capsys):
    with pytest.raises(SystemExit) as exc:
        designer.main(["--version"])
    assert exc.value.code == 0
    assert version("mnt.designer") in capsys.readouterr().out
    calls = []
    monkeypatch.setattr(designer, "start_server", lambda **kwargs: calls.append(kwargs))
    designer.main(["--host", "127.0.0.1", "--port", "5053", "--no-browser"])
    assert calls == [{"host": "127.0.0.1", "port": 5053, "open_browser": False}]


@pytest.mark.parametrize("host,url_host", [("127.0.0.1", "127.0.0.1"), ("localhost", "localhost"), ("::1", "[::1]")])
def test_cli_browser_url_preserves_bind_host(monkeypatch, capsys, host, url_host):
    opened = []
    calls = []
    monkeypatch.setattr(designer.webbrowser, "open", opened.append)
    monkeypatch.setattr(designer.app, "run", lambda **kwargs: calls.append(kwargs))
    designer.main(["--host", host, "--port", "5053"])
    assert opened == [f"http://{url_host}:5053"]
    assert opened[0] in capsys.readouterr().out
    assert calls == [{"debug": False, "host": host, "port": 5053}]
