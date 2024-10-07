from flask import Flask, render_template, request, jsonify, session
from mnt.pyfiction import cartesian_gate_layout, route_path
import uuid

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
        elif gate_type == 'buf':
            source_x = int(params['first']['position']['x'])
            source_y = int(params['first']['position']['y'])
            source_node = layout.get_node((source_x, source_y))
            layout.create_buf(layout.make_signal(source_node), (x, y))
        elif gate_type == 'and':
            first_x = int(params['first']['position']['x'])
            first_y = int(params['first']['position']['y'])
            second_x = int(params['second']['position']['x'])
            second_y = int(params['second']['position']['y'])
            first_node = layout.get_node((first_x, first_y))
            second_node = layout.get_node((second_x, second_y))
            layout.create_and(layout.make_signal(first_node), layout.make_signal(second_node), (x, y))

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

if __name__ == '__main__':
    app.run(debug=True)
