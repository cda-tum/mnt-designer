import sys
import json
from flask import request, jsonify
from mnt.pyfiction import cartesian_gate_layout, offset_coordinate

from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')  # This will look for index.html in the "templates" folder


# Global variable to hold the layout
layout = cartesian_gate_layout((0,0,0), "2DDWave", "Layout")

@app.route('/create_layout', methods=['POST'])
def create_layout():
    global layout
    data = request.json
    x = data.get('x')
    y = data.get('y')
    z = 0  # You can change this if needed

    try:
        # Create the cartesian layout with the given dimensions
        layout.resize((x,y,z))
        return jsonify({'success': True, 'message': 'Layout created successfully'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/place_gate', methods=['POST'])
def place_gate():
    global layout
    data = request.json
    x = data.get('x')
    y = data.get('y')
    gate_type = data.get('gate_type')
    params = data.get('params')

    try:
        if gate_type == 'pi':
            layout.create_pi(params['name'], (x, y))
        elif gate_type == 'and':
            layout.create_and(params['first']['signal'], params['second']['signal'], (x, y))  # Using both incoming signals
        elif gate_type == 'buf':
            layout.create_buf(layout.make_signal(layout.get_node((params['first']['position']['x'], params['first']['position']['y']))), (x, y))  # Using first incoming signal

        return jsonify({'success': True})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)})


if __name__ == '__main__':
    app.run(debug=True)