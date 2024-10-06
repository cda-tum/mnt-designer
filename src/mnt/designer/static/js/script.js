let selectedCell = null;
let selectedSignals = {}; // Change to an object to hold multiple signals

// Handle form submission for grid creation
document.getElementById('dimension-form').addEventListener('submit', function(event) {
    event.preventDefault();

    const xDimension = document.getElementById('x-dimension').value;
    const yDimension = document.getElementById('y-dimension').value;

    fetch('/create_layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            x: parseInt(xDimension),
            y: parseInt(yDimension)
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            createGrid(parseInt(xDimension), parseInt(yDimension));
        } else {
            alert('Failed to create layout.');
        }
    });
});

function createGrid(x, y) {
    const container = document.getElementById('grid-container');
    container.innerHTML = ''; // Clear previous grid if it exists

    for (let i = 0; i < x; i++) {
        const row = document.createElement('div');
        row.className = 'grid-row';
        for (let j = 0; j < y; j++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.id = `cell-${i}-${j}`;
            cell.innerText = `(${i},${j})`;
            cell.addEventListener('click', () => selectCell(cell, i, j));
            row.appendChild(cell);
        }
        container.appendChild(row);
    }
}

// Handle cell selection
function selectCell(cell, x, y) {
    if (selectedCell) {
        selectedCell.classList.remove('selected');
    }
    selectedCell = cell;
    cell.classList.add('selected');

    // Show modal to select gate
    showModal(x, y);
}

// Show modal and handle gate placement
function showModal(x, y) {
    const modal = document.getElementById('gate-modal');
    modal.style.display = 'block';

    // Clear previous signals
    document.getElementById('gate-parameters').innerHTML = '';

    document.getElementById('place-gate-button').onclick = function() {
        const gateType = document.getElementById('gate-type').value;

        // Prepare parameters based on gate type
        let gateParams = {};

        if (gateType === 'pi') {
            const piName = prompt("Enter PI name:");
            gateParams = { name: piName };
            placeGate(x, y, gateType, gateParams); // Place the gate directly
            modal.style.display = 'none'; // Close the modal
        } else if (gateType === 'and' || gateType === 'buf') {
            // Create signal selection mode
            document.getElementById('gate-parameters').innerHTML = `
                <p>Select the incoming signals:</p>
                <div id="signal-selection"></div>
            `;
            setupSignalSelection(gateType, x, y);
        }
    };

    document.getElementById('cancel-gate-button').onclick = function() {
        modal.style.display = 'none';
    };
}

// Set up the signal selection area
function setupSignalSelection(gateType, x, y) {
    const signalSelectionDiv = document.getElementById('signal-selection');

    // Enable clicking on the grid cells to select signals
    signalSelectionDiv.innerHTML = 'Click on a cell to select the incoming signals.';

    // Add event listeners to grid cells
    const gridCells = document.querySelectorAll('.grid-cell');
    gridCells.forEach(cell => {
        cell.addEventListener('click', (event) => {
            const cellId = cell.id.split('-');
            const cellX = parseInt(cellId[1]);
            const cellY = parseInt(cellId[2]);

            // Check if the clicked cell contains a gate
            if (cell.innerText !== `(${cellX},${cellY})`) {
                const signalName = cell.innerText;  // The text inside the cell (e.g., "PI", "AND")

                // Depending on the gate type, store the selected signal
                if (!selectedSignals.first) {
                    selectedSignals.first = { signal: signalName, position: { x: cellX, y: cellY } };
                } else {
                    selectedSignals.second = { signal: signalName, position: { x: cellX, y: cellY } };

                    // Close the modal and place the gate when both signals are selected
                    placeGate(x, y, gateType, selectedSignals);
                    document.getElementById('gate-modal').style.display = 'none';
                }

                // Highlight the selected signal cell
                cell.classList.add('selected-signal');
            } else {
                alert('Please select a cell with an existing gate.');
            }

            event.stopPropagation(); // Prevent triggering the cell's select event
        });
    });
}

// Send gate placement info to the backend
function placeGate(x, y, gateType, selectedParams) {
    fetch('/place_gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            x: x,
            y: y,
            gate_type: gateType,
            params: selectedParams
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update the selected cell to show the gate type and incoming signal(s)
            if (gateType === 'pi') {
                selectedCell.innerText = `PI (${selectedParams.name})`;
            } else if (gateType === 'and') {
                selectedCell.innerText = `AND (${selectedParams.first.signal}, ${selectedParams.second.signal})`;
            } else if (gateType === 'buf') {
                selectedCell.innerText = `BUF (${selectedParams.first.signal})`;
            }
            alert('Gate placed successfully');
        } else {
            alert('Failed to place gate.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to place gate.');
    });
}
