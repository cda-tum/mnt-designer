$(document).ready(() => {
    let selectedGateType = null;
    let selectedNode = null;
    let selectedSourceNode = null;
    let selectedSourceNode2 = null;
    let cy = null;
    let layoutDimensions = { x: 0, y: 0 };
    const tileColors = {
        1: "#ffffff", // White
        2: "#bfbfbf", // Light Gray
        3: "#7f7f7f", // Medium Gray
        4: "#3f3f3f"  // Dark Gray
    };

    // Initialize Cytoscape instance
    function initializeCytoscape() {
        cy = cytoscape({
            container: document.getElementById('cy'),
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'color': '#000',
                        'background-color': 'data(color)',
                        'width': '50px',
                        'height': '50px',
                        'shape': 'rectangle',
                        'font-size': '12px',
                        'border-width': 2,
                        'border-color': '#000',
                        'text-wrap': 'wrap',
                        'text-max-width': '45px',
                        // Ensure the gate label is centered
                        'text-margin-y': '0px',
                        // Allow background image (tile number) to display
                        'background-fit': 'contain',
                        'background-clip': 'node',
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#555',
                        'target-arrow-color': '#555',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier'
                    }
                },
                {
                    selector: '.highlighted',
                    style: {
                        'border-color': '#dc3545',
                        'border-width': 4
                    }
                }
            ],
            elements: [],
            layout: {
                name: 'preset'
            },
            userZoomingEnabled: false,
            userPanningEnabled: false,
            boxSelectionEnabled: false
        });

        // Disable node dragging
        cy.nodes().ungrabify();

        // Node click handler
        cy.on('tap', 'node', (evt) => {
            const node = evt.target;
            if (!selectedGateType) {
                updateMessageArea('Please select a gate or action first.', 'warning');
                return;
            }

            switch (selectedGateType) {
                case 'pi':
                    selectedNode = node;
                    handlePlaceGate();
                    break;
                case 'buf':
                case 'and':
                    handleGatePlacement(node);
                    break;
                case 'connect':
                    handleConnectGates(node);
                    break;
                case 'delete':
                    deleteGate(node);
                    break;
                default:
                    break;
            }
        });
    }

    // Initialize Cytoscape
    initializeCytoscape();

    // Gate selection
    $('#gate-selection button').on('click', function () {
        const buttonId = $(this).attr('id');
        selectedGateType = buttonId.split('-')[0]; // 'pi', 'buf', 'and', 'connect', 'delete', 'cancel'
        $('#gate-selection button').removeClass('active');

        if (selectedGateType === 'cancel') {
            cancelPlacement();
        } else {
            $(this).addClass('active');

            if (selectedGateType === 'delete') {
                updateMessageArea('Select a gate to delete.', 'info');
            } else if (selectedGateType === 'connect') {
                updateMessageArea('Select the source gate to connect.', 'info');
            } else {
                updateMessageArea(`Selected ${selectedGateType.toUpperCase()} gate. Click on a tile to place.`, 'info');
            }
        }
    });

    // Function to cancel gate placement
    function cancelPlacement() {
        // Reset selections
        selectedGateType = null;
        selectedNode = null;
        selectedSourceNode = null;
        selectedSourceNode2 = null;

        // Remove highlights from any highlighted nodes
        cy.nodes().removeClass('highlighted');

        // Update UI
        $('#gate-selection button').removeClass('active');
        updateMessageArea('Action cancelled.', 'secondary');
    }

    // Message area update function
    function updateMessageArea(message, type = 'info') {
        $('#message-area').removeClass().addClass(`alert alert-${type} text-center`).text(message);
    }

    // Handle layout creation
    $('#layout-form').on('submit', function (event) {
        event.preventDefault();
        const xDimension = parseInt($('#x-dimension').val());
        const yDimension = parseInt($('#y-dimension').val());

        // Send the new dimensions to the server
        $.ajax({
            url: '/create_layout',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ x: xDimension, y: yDimension }),
            success: (data) => {
                if (data.success) {
                    createGridNodes(xDimension, yDimension);
                    updateMessageArea('Layout resized successfully. Existing gates are preserved.', 'success');
                } else {
                    updateMessageArea('Failed to resize layout: ' + data.error, 'danger');
                }
            },
            error: (jqXHR, textStatus, errorThrown) => {
                updateMessageArea('Error resizing layout: ' + errorThrown, 'danger');
            }
        });
    });

    function createGridNodes(newX, newY) {
        const existingNodes = cy.nodes();

        // Find the current maximum dimensions
        let maxX = 0;
        let maxY = 0;
        existingNodes.forEach((node) => {
            const x = node.data('x');
            const y = node.data('y');
            if (x >= newX || y >= newY) {
                cy.remove(node);
            }
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        });

        // Determine if we need to add new columns
        for (let i = 0; i < newX; i++) {
            for (let j = 0; j < newY; j++) {
                // Check if the node already exists
                const nodeId = `node-${i}-${j}`;
                if (cy.getElementById(nodeId).length === 0) {
                    // Node doesn't exist, add it
                    const tileNumber = ((i + j) % 4) + 1; // Calculate tile number
                    const tileColor = tileColors[tileNumber];

                    cy.add({
                        data: {
                            id: nodeId,
                            label: '', // Gate label, initially empty
                            x: i,
                            y: j,
                            tileNumber: tileNumber,
                            color: tileColor,
                            hasGate: false,
                        },
                        position: { x: i * 60, y: j * 60 },
                        locked: true
                    });

                    // Add tile number as background image
                    const newNode = cy.getElementById(nodeId);
                    newNode.style({
                        'background-image': `data:image/svg+xml;utf8,${encodeURIComponent(createTileNumberSVG(tileNumber))}`,
                        'background-width': '100%',
                        'background-height': '100%',
                        'background-position': 'bottom right',
                        'background-repeat': 'no-repeat',
                        'background-clip': 'none',
                    });
                }
            }
        }

        // Update the layout dimensions
        layoutDimensions.x = newX;
        layoutDimensions.y = newY;

        // Re-apply the layout
        cy.layout({ name: 'preset' }).run();
        cy.fit();
    }

    function createTileNumberSVG(number) {
        // Determine the text color based on the tile number
        const textColor = (number === 1 || number === 2) ? '#000000' : '#ffffff'; // Black for 1 and 2, white for 3 and 4

        return `
            <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
                <text x="45" y="45" text-anchor="end" alignment-baseline="baseline" font-size="10" fill="${textColor}">${number}</text>
            </svg>
        `;
    }

    // Handle PI gate placement
    function handlePlaceGate() {
        if (selectedNode.data('hasGate')) {
            updateMessageArea('Cannot place a gate on a non-empty tile.', 'danger');
            selectedNode = null;
            return;
        }

        const x = selectedNode.data('x');
        const y = selectedNode.data('y');

        placeGate(x, y, 'pi', {});
        updateMessageArea('PI gate placed successfully.', 'success');
        selectedNode = null;
    }

    // Handle BUF and AND gate placement
    function handleGatePlacement(node) {
        if (!selectedNode) {
            selectedNode = node;
            if (selectedNode.data('hasGate')) {
                updateMessageArea('Cannot place a gate on a non-empty tile.', 'danger');
                selectedNode = null;
                return;
            }
            if (selectedGateType === 'buf') {
                updateMessageArea(`Selected node (${node.data('x')},${node.data('y')}) to place BUF gate. Now select an adjacent incoming signal node.`, 'info');
            } else if (selectedGateType === 'and') {
                updateMessageArea(`Selected node (${node.data('x')},${node.data('y')}) to place AND gate. Now select the first adjacent incoming signal node.`, 'info');
            }
        } else {
            if (selectedGateType === 'buf') {
                handleBufGatePlacement(node);
            } else if (selectedGateType === 'and') {
                handleAndGatePlacement(node);
            }
        }
    }

    // BUF Gate placement
    function handleBufGatePlacement(node) {
        if (!node.data('hasGate')) {
            updateMessageArea('The incoming signal node must have a gate.', 'danger');
            return;
        }
        if (!areNodesAdjacentCardinal(selectedNode, node)) {
            updateMessageArea('Please select an adjacent node (left, right, top, bottom) as the incoming signal.', 'danger');
            return;
        }
        if (!isValidTileTransition(node, selectedNode)) {
            updateMessageArea('Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.', 'danger');
            return;
        }
        selectedSourceNode = node;
        // Highlight the selected source node
        selectedSourceNode.addClass('highlighted');
        placeGateWithOneSignal();
    }

    // AND Gate placement
    function handleAndGatePlacement(node) {
        if (!node.data('hasGate')) {
            updateMessageArea('The incoming signal node must have a gate.', 'danger');
            return;
        }
        if (!selectedSourceNode) {
            if (!areNodesAdjacentCardinal(selectedNode, node)) {
                updateMessageArea('Please select an adjacent node (left, right, top, bottom) as the first incoming signal.', 'danger');
                return;
            }
            if (!isValidTileTransition(node, selectedNode)) {
                updateMessageArea('Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.', 'danger');
                return;
            }
            selectedSourceNode = node;
            // Highlight the first selected source node
            selectedSourceNode.addClass('highlighted');
            updateMessageArea('Now select the second adjacent incoming signal node.', 'info');
        } else if (!selectedSourceNode2) {
            if (!node.data('hasGate')) {
                updateMessageArea('The incoming signal node must have a gate.', 'danger');
                return;
            }
            if (!areNodesAdjacentCardinal(selectedNode, node)) {
                updateMessageArea('Please select an adjacent node (left, right, top, bottom) as the second incoming signal.', 'danger');
                return;
            }
            if (node.id() === selectedSourceNode.id()) {
                updateMessageArea('The second incoming signal cannot be the same as the first.', 'danger');
                return;
            }
            if (!isValidTileTransition(node, selectedNode)) {
                updateMessageArea('Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.', 'danger');
                return;
            }
            selectedSourceNode2 = node;
            // Highlight the second selected source node
            selectedSourceNode2.addClass('highlighted');
            placeGateWithTwoSignals();
        }
    }

    // Check if nodes are adjacent in cardinal directions (no diagonals)
    function areNodesAdjacentCardinal(nodeA, nodeB) {
        const x1 = nodeA.data('x');
        const y1 = nodeA.data('y');
        const x2 = nodeB.data('x');
        const y2 = nodeB.data('y');

        const dx = x1 - x2;
        const dy = y1 - y2;

        // Check for adjacency in cardinal directions
        return (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1);
    }

    // Check if tile numbers satisfy the specific sequence
    function isValidTileTransition(sourceNode, targetNode) {
        const sourceNumber = sourceNode.data('tileNumber');
        const targetNumber = targetNode.data('tileNumber');

        return (sourceNumber === 1 && targetNumber === 2) ||
            (sourceNumber === 2 && targetNumber === 3) ||
            (sourceNumber === 3 && targetNumber === 4) ||
            (sourceNumber === 4 && targetNumber === 1);
    }

    // Place gate with one signal (BUF)
    function placeGateWithOneSignal() {
        const gateX = selectedNode.data('x');
        const gateY = selectedNode.data('y');

        placeGate(gateX, gateY, 'buf', {
            first: { position: { x: selectedSourceNode.data('x'), y: selectedSourceNode.data('y') } }
        });

        cy.add({
            group: 'edges',
            data: {
                id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
                source: selectedSourceNode.id(),
                target: selectedNode.id()
            }
        });

        // Remove highlight from source node
        selectedSourceNode.removeClass('highlighted');

        updateMessageArea('BUF gate placed successfully.', 'success');

        selectedNode = null;
        selectedSourceNode = null;
    }

    // Place gate with two signals (AND)
    function placeGateWithTwoSignals() {
        const gateX = selectedNode.data('x');
        const gateY = selectedNode.data('y');

        placeGate(gateX, gateY, 'and', {
            first: { position: { x: selectedSourceNode.data('x'), y: selectedSourceNode.data('y') } },
            second: { position: { x: selectedSourceNode2.data('x'), y: selectedSourceNode2.data('y') } }
        });

        cy.add([
            {
                group: 'edges',
                data: {
                    id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
                    source: selectedSourceNode.id(),
                    target: selectedNode.id()
                }
            },
            {
                group: 'edges',
                data: {
                    id: `edge-${selectedSourceNode2.id()}-${selectedNode.id()}`,
                    source: selectedSourceNode2.id(),
                    target: selectedNode.id()
                }
            }
        ]);

        // Remove highlights from source nodes
        selectedSourceNode.removeClass('highlighted');
        selectedSourceNode2.removeClass('highlighted');

        updateMessageArea('AND gate placed successfully.', 'success');

        selectedNode = null;
        selectedSourceNode = null;
        selectedSourceNode2 = null;
    }

    function placeGate(x, y, gateType, params) {
        $.ajax({
            url: '/place_gate',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                x: parseInt(x),
                y: parseInt(y),
                gate_type: gateType,
                params: params
            }),
            success: (data) => {
                if (data.success) {
                    const node = cy.getElementById(`node-${x}-${y}`);
                    node.data('label', `${gateType.toUpperCase()}`);
                    node.data('hasGate', true);

                    // Apply custom colors based on the gate type
                    let gateColor = node.data('color'); // Default to tile color

                    if (gateType === 'pi') {
                        gateColor = 'snow'; // Set to 'snow2' for PI gate
                    } else if (gateType === 'buf') {
                        gateColor = 'palegoldenrod'; // Set to 'palegoldenrod' for BUF gate
                    } else if (gateType === 'and') {
                        gateColor = 'lightpink'; // Set to 'lightpink' for AND gate
                    }

                    // Apply the chosen background color
                    node.style('background-color', gateColor);

                    // Ensure the tile number remains visible
                    const tileNumber = node.data('tileNumber');
                    node.style({
                        'background-image': `data:image/svg+xml;utf8,${encodeURIComponent(createTileNumberSVG(tileNumber))}`,
                        'background-width': '100%',
                        'background-height': '100%',
                        'background-position': 'bottom right',
                        'background-repeat': 'no-repeat',
                        'background-clip': 'none',
                    });
                } else {
                    updateMessageArea('Failed to place gate: ' + data.error, 'danger');
                }
            },
            error: (jqXHR, textStatus, errorThrown) => {
                updateMessageArea('Error communicating with the server: ' + errorThrown, 'danger');
            }
        });
    }

    // Delete gate
    function deleteGate(node) {
        const x = node.data('x');
        const y = node.data('y');

        $.ajax({
            url: '/delete_gate',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ x: x, y: y }),
            success: (data) => {
                if (data.success) {
                    // Reset node label and style
                    node.data('label', '');
                    node.data('hasGate', false);
                    node.style('background-color', node.data('color'));

                    // Remove connected edges
                    const connectedEdges = node.connectedEdges();
                    cy.remove(connectedEdges);

                    // Ensure tile number remains visible
                    const tileNumber = node.data('tileNumber');
                    node.style({
                        'background-image': `data:image/svg+xml;utf8,${encodeURIComponent(createTileNumberSVG(tileNumber))}`,
                        'background-width': '100%',
                        'background-height': '100%',
                        'background-position': 'bottom right',
                        'background-repeat': 'no-repeat',
                        'background-clip': 'none',
                    });

                    updateMessageArea('Gate deleted successfully.', 'success');
                } else {
                    updateMessageArea('Failed to delete gate: ' + data.error, 'danger');
                }
            },
            error: () => {
                updateMessageArea('Error communicating with the server.', 'danger');
            }
        });
    }

    // Connect two existing gates
    function handleConnectGates(node) {
        if (!selectedSourceNode) {
            if (!node.data('hasGate')) {
                updateMessageArea('Please select a gate as the source.', 'danger');
                return;
            }
            selectedSourceNode = node;
            selectedSourceNode.addClass('highlighted');
            updateMessageArea('Now select the target gate to connect.', 'info');
        } else if (!selectedNode) {
            if (!node.data('hasGate')) {
                updateMessageArea('Please select a gate as the target.', 'danger');
                return;
            }
            if (node.id() === selectedSourceNode.id()) {
                updateMessageArea('Cannot connect a gate to itself.', 'danger');
                return;
            }
            if (!areNodesAdjacentCardinal(selectedSourceNode, node)) {
                updateMessageArea('Gates must be adjacent (left, right, top, bottom) to connect.', 'danger');
                selectedSourceNode.removeClass('highlighted');
                selectedSourceNode = null;
                return;
            }
            if (!isValidTileTransition(selectedSourceNode, node)) {
                updateMessageArea('Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.', 'danger');
                selectedSourceNode.removeClass('highlighted');
                selectedSourceNode = null;
                return;
            }
            selectedNode = node;
            selectedNode.addClass('highlighted');

            // Create connection
            connectGates();
        }
    }

    function connectGates() {
        const sourceX = selectedSourceNode.data('x');
        const sourceY = selectedSourceNode.data('y');
        const targetX = selectedNode.data('x');
        const targetY = selectedNode.data('y');

        $.ajax({
            url: '/connect_gates',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                source_x: sourceX,
                source_y: sourceY,
                target_x: targetX,
                target_y: targetY
            }),
            success: (data) => {
                if (data.success) {
                    cy.add({
                        group: 'edges',
                        data: {
                            id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
                            source: selectedSourceNode.id(),
                            target: selectedNode.id()
                        }
                    });

                    updateMessageArea('Gates connected successfully.', 'success');
                } else {
                    updateMessageArea('Failed to connect gates: ' + data.error, 'danger');
                }
                // Remove highlights
                selectedSourceNode.removeClass('highlighted');
                selectedNode.removeClass('highlighted');
                selectedSourceNode = null;
                selectedNode = null;
            },
            error: () => {
                updateMessageArea('Error communicating with the server.', 'danger');
                // Remove highlights
                selectedSourceNode.removeClass('highlighted');
                selectedNode.removeClass('highlighted');
                selectedSourceNode = null;
                selectedNode = null;
            }
        });
    }
});
