from flask import Flask, render_template, request, jsonify, session, make_response
from mnt.pyfiction import cartesian_gate_layout, route_path, gate_level_drvs, \
    write_fgl_layout, read_cartesian_fgl_layout  # Ensure your module imports are correct
import uuid
import tempfile

from numpy.testing.print_coercion_tables import print_new_cast_table

app = Flask(__name__)
app.secret_key = 'your_secret_key'  # Replace with a secure secret key

# In-memory storage for user layouts
layouts = {}

@app.route('/')
def index():
    # Assign a unique session ID if not already present
    if 'session_id' not in session:
        session['session_id'] = str(uuid.uuid4())
    return render_template('index.html')

@app.route('/create_layout', methods=['POST'])
def create_layout():
    try:
        data = request.json
        x = int(data.get('x')) - 1
        y = int(data.get('y')) - 1
        z = 0  # Default Z value

        session_id = session['session_id']
        layout = layouts.get(session_id)

        if not layout:
            # Create a new layout if one doesn't exist
            layout = cartesian_gate_layout((0, 0, 0), "2DDWave", "Layout")
            layouts[session_id] = layout

        # Resize the existing layout
        layout.resize((x, y, z))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/place_gate', methods=['POST'])
def place_gate():
    try:
        data = request.json
        x = int(data['x'])
        y = int(data['y'])
        gate_type = data['gate_type']
        params = data['params']

        session_id = session['session_id']
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        node = layout.get_node((x, y))
        if node is not None and getattr(node, 'gate_type', None):
            return jsonify({'success': False, 'error': 'Tile already has a gate.'})

        if gate_type == 'pi':
            layout.create_pi('', (x, y))
        elif gate_type == 'po':
            source_x = int(params['first']['position']['x'])
            source_y = int(params['first']['position']['y'])
            source_node = layout.get_node((source_x, source_y))
            layout.create_po(layout.make_signal(source_node), "", (x, y))
        elif gate_type == 'inv':
            source_x = int(params['first']['position']['x'])
            source_y = int(params['first']['position']['y'])
            source_node = layout.get_node((source_x, source_y))
            layout.create_not(layout.make_signal(source_node), (x, y))
        elif gate_type == 'buf':
            source_x = int(params['first']['position']['x'])
            source_y = int(params['first']['position']['y'])
            source_node = layout.get_node((source_x, source_y))
            layout.create_buf(layout.make_signal(source_node), (x, y))
        elif gate_type in ['and', 'or', 'nor', 'xor', 'xnor']:
            first_x = int(params['first']['position']['x'])
            first_y = int(params['first']['position']['y'])
            second_x = int(params['second']['position']['x'])
            second_y = int(params['second']['position']['y'])
            first_node = layout.get_node((first_x, first_y))
            second_node = layout.get_node((second_x, second_y))
            if gate_type == 'and':
                layout.create_and(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))
            elif gate_type == 'or':
                layout.create_or(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))
            elif gate_type == 'nor':
                layout.create_nor(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))
            elif gate_type == 'xor':
                layout.create_xor(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))
            elif gate_type == 'xnor':
                layout.create_xnor(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))
        else:
            return jsonify({'success': False, 'error': f'Unsupported gate type: {gate_type}'})

        print(layout)
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error in place_gate: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_gate', methods=['POST'])
def delete_gate():
    try:
        data = request.json
        x = int(data['x'])
        y = int(data['y'])

        session_id = session['session_id']
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        # Remove the gate from the layout
        node = layout.get_node((x, y))
        if node:
            # Find all gates that use this node as an input signal
            outgoing_tiles = layout.fanouts((x, y))
            layout.move_node(node, (x, y), [])
            layout.clear_tile((x, y))

            # Update signals for dependent nodes
            for outgoing_tile in outgoing_tiles:
                # Get the other input signals, if any
                incoming_tiles = layout.fanins(outgoing_tile)
                incoming_tiles = [inp for inp in incoming_tiles if inp != (x, y)]
                layout.move_node(layout.get_node(outgoing_tile), outgoing_tile, incoming_tiles)

            print(layout)
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': 'Gate not found at the specified position.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/connect_gates', methods=['POST'])
def connect_gates():
    try:
        data = request.json
        source_x = int(data['source_x'])
        source_y = int(data['source_y'])
        target_x = int(data['target_x'])
        target_y = int(data['target_y'])

        session_id = session['session_id']
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        source_node = layout.get_node((source_x, source_y))
        target_node = layout.get_node((target_x, target_y))

        if not source_node:
            return jsonify({'success': False, 'error': 'Source gate not found.'})
        if not target_node:
            return jsonify({'success': False, 'error': 'Target gate not found.'})

        # Create a connection from source_node to target_node
        route_path(layout, [(source_x, source_y), (target_x, target_y)])

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/check_design_rules', methods=['POST'])
def check_design_rules():
    try:
        session_id = session['session_id']
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        # Call your design rule checking function
        violations = check_design_rules_function(layout)  # Replace with your actual function

        return jsonify({'success': True, 'violations': violations})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


from flask import send_file, jsonify, session
import os


@app.route('/export_layout', methods=['GET'])
def export_layout():
    try:
        session_id = session.get('session_id')
        layout = layouts.get(session_id)

        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        # Serialize the layout to XML file
        file_path = "layout.fgl"
        write_fgl_layout(layout, file_path)

        # Send the XML file as an attachment
        return send_file(file_path, as_attachment=True,
                         mimetype='application/xml',
                         download_name='layout.xml')

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
    finally:
        # Clean up the file if it exists
        if os.path.exists(file_path):
            os.remove(file_path)

@app.route('/import_layout', methods=['POST'])
def import_layout():
    try:
        # Get the uploaded file with the key 'file'
        file = request.files.get('file')
        if not file:
            return jsonify({'success': False, 'error': 'No file provided.'})

        # Create a temporary file to save the uploaded XML file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xml') as temp_file:
            file.save(temp_file.name)  # Save the uploaded file to the temporary file

        # Call the function with the temporary file's name (path)
        try:
            layout = read_cartesian_fgl_layout(temp_file.name)
        finally:
            # Clean up: delete the temporary file after processing
            os.remove(temp_file.name)

        # Parse the layout from the XML content
        session_id = session['session_id']
        layouts[session_id] = layout

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_layout', methods=['GET'])
def get_layout():
    try:
        session_id = session['session_id']
        layout = layouts.get(session_id)
        if not layout:
            return jsonify({'success': False, 'error': 'Layout not found.'})

        # Extract layout data
        layout_dimensions = {'x': layout.x() + 1, 'y': layout.y() + 1}
        gates = []

        for x in range(layout.x() + 1):
            for y in range(layout.y() + 1):
                node = layout.get_node((x, y))
                if node:
                    if layout.is_pi(node):
                        gate_type = 'pi'
                    elif layout.is_po(node):
                        gate_type = 'po'
                    elif layout.is_wire(node):
                        gate_type = 'buf'
                    elif layout.is_inv(node):
                        gate_type = 'inv'
                    elif layout.is_and(node):
                        gate_type = 'and'
                    elif layout.is_nand(node):
                        gate_type = 'nand'
                    elif layout.is_or(node):
                        gate_type = 'or'
                    elif layout.is_nor(node):
                        gate_type = 'nor'
                    elif layout.is_xor(node):
                        gate_type = 'xor'
                    elif layout.is_xnor(node):
                        gate_type = 'xnor'
                    else:
                        raise Exception("Unsupported gate type")

                    gate_info = {
                        'x': x,
                        'y': y,
                        'type': gate_type,
                        'connections': []
                    }
                    # Get fanins (source nodes)
                    fanins = layout.fanins((x, y))
                    for fin in fanins:
                        gate_info['connections'].append({'sourceX': fin.x, 'sourceY': fin.y})
                    gates.append(gate_info)
        return jsonify({'success': True, 'layoutDimensions': layout_dimensions, 'gates': gates})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def check_design_rules_function(layout):
    violations = gate_level_drvs(layout, print_report=True)
    return violations

if __name__ == '__main__':
    app.run(debug=True)
