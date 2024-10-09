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
    4: "#3f3f3f", // Dark Gray
  };

  // Initialize Ace Editor
  let editor = ace.edit("editor-container");
  editor.setTheme("ace/theme/monokai");
  editor.session.setMode("ace/mode/verilog");

  // Debounce function to limit the rate of AJAX calls
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Save code to backend on change with debounce
  editor.session.on('change', debounce(function () {
    let code = editor.getValue();
    $.ajax({
      url: "/save_verilog_code",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ code: code }),
      success: function(data) {
        if (!data.success) {
          updateMessageArea("Failed to save verilog: " + data.error, "danger");
        }
        else {
          updateMessageArea("Updated verilog", "info");
        }
      },
      error: function(jqXHR, textStatus, errorThrown) {
        updateMessageArea("Error communicating with the server: " + errorThrown, "danger");
      }
    });
  }, 1000));

  // Initialize Cytoscape instance
  function initializeCytoscape() {
    cy = cytoscape({
      container: document.getElementById("cy"),
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            color: "#000",
            "background-color": "data(color)",
            width: "50px",
            height: "50px",
            shape: "rectangle",
            "font-size": "12px",
            "border-width": 2,
            "border-color": "#000",
            "text-wrap": "wrap",
            "text-max-width": "45px",
            // Ensure the gate label is centered
            "text-margin-y": "0px",
            // Allow background image (tile number) to display
            "background-fit": "contain",
            "background-clip": "node",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#555",
            "target-arrow-color": "#555",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: ".highlighted",
          style: {
            "border-color": "#dc3545",
            "border-width": 4,
          },
        },
      ],
      elements: [],
      layout: {
        name: "preset",
      },
      userZoomingEnabled: true,  // Allow zooming
      userPanningEnabled: true,  // Allow panning
      wheelSensitivity: 0.5,     // Adjust zoom speed (optional)
      boxSelectionEnabled: false,
      panningEnabled: true,  // Enable panning
      autoungrabify: true,      // Nodes cannot be grabbed (dragged)
      autounselectify: true,    // Nodes cannot be selected
    });

    // Disable node dragging
    cy.nodes().ungrabify();

    // Node click handler
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      if (!selectedGateType) {
        updateMessageArea("Please select a gate or action first.", "warning");
        return;
      }

      switch (selectedGateType) {
        case "pi":
          selectedNode = node;
          handlePlaceGate();
          break;
        case "buf":
        case "inv":
        case "po":
        case "and":
        case "or":
        case "nor":
        case "xor":
        case "xnor":
          handleGatePlacement(node);
          break;
        case "connect":
          handleConnectGates(node);
          break;
        case "delete":
          deleteGate(node);
          break;
        default:
          break;
      }
    });
  }

  // Initialize Cytoscape
  initializeCytoscape();

  // Load the layout from the backend
  loadLayout();

  function updateLayout(layoutDimensions, gates) {
    // Clear existing elements
    cy.elements().remove();

    // Recreate the grid with new dimensions
    createGridNodes(layoutDimensions.x, layoutDimensions.y);

    // Place gates and connections based on the new layout data
    gates.forEach((gate) => {
      // Place the gate
      placeGateLocally(gate.x, gate.y, gate.type);

      // Handle connections (edges)
      gate.connections.forEach((conn) => {
        cy.add({
          group: "edges",
          data: {
            id: `edge-node-${conn.sourceX}-${conn.sourceY}-node-${gate.x}-${gate.y}`,
            source: `node-${conn.sourceX}-${conn.sourceY}`,
            target: `node-${gate.x}-${gate.y}`,
          },
        });
      });
    });

    // Update gate labels after loading
    updateGateLabels();

    // Fit the Cytoscape view to the new layout
    cy.fit();
  }

  cy.nodes().ungrabify();

  // Panning using arrow keys
  document.addEventListener('keydown', function(event) {
    const panAmount = 50; // Adjust this value to change pan speed
    if (event.key === 'ArrowLeft') {
      cy.panBy({ x: panAmount, y: 0 });
      event.preventDefault(); // Prevent the default scrolling behavior
    } else if (event.key === 'ArrowRight') {
      cy.panBy({ x: -panAmount, y: 0 });
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      cy.panBy({ x: 0, y: panAmount });
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      cy.panBy({ x: 0, y: -panAmount });
      event.preventDefault();
    }
  });

  // Zoom In Button
  $("#zoom-in").on("click", function () {
    let zoomLevel = cy.zoom();
    cy.zoom({
      level: zoomLevel * 1.2, // Increase zoom by 20%
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }  // Zoom towards the center
    });
  });

  // Zoom Out Button
  $("#zoom-out").on("click", function () {
    let zoomLevel = cy.zoom();
    cy.zoom({
      level: zoomLevel * 0.8, // Decrease zoom by 20%
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }  // Zoom towards the center
    });
  });

  // Reset Zoom Button
  $("#reset-zoom").on("click", function () {
    cy.fit();  // Reset zoom to fit the entire layout in view
  });

  // Ortho Button Click Handler
  $("#ortho-button").on("click", function () {
    // Disable the button to prevent multiple clicks
    $("#ortho-button").prop("disabled", true);
    updateMessageArea("Applying ortho...", "info");

    $.ajax({
      url: "/apply_orthogonal",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({}),
      success: (data) => {
        $("#ortho-button").prop("disabled", false); // Re-enable button
        if (data.success) {
          // Update the layout with the new data
          updateLayout(data.layoutDimensions, data.gates);
          updateMessageArea("Created layout with ortho successfully.", "success");
        } else {
          updateMessageArea("Failed to create layout using ortho: " + data.error, "danger");
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        $("#ortho-button").prop("disabled", false); // Re-enable button
        updateMessageArea("Error communicating with the server: " + errorThrown, "danger");
      },
    });
  });

  // Trigger file input when the import verilog button is clicked
  $("#import-verilog-button").on("click", function () {
    $("#import-verilog-file-input").click(); // Trigger file input dialog
  });

  // Handle File Selection and upload it
  $("#import-verilog-file-input").on("change", function () {
    const file = this.files[0]; // Get the selected file
    if (file) {
      const formData = new FormData();
      formData.append("file", file);

      // Disable the button and show a loading message
      $("#import-verilog-button").prop("disabled", true);
      updateMessageArea("Uploading Verilog code...", "info");

      $.ajax({
        url: "/import_verilog_code",
        type: "POST",
        data: formData,
        processData: false, // Prevent jQuery from processing the data
        contentType: false, // Let the browser set the correct content type
        success: (data) => {
          $("#import-verilog-button").prop("disabled", false); // Re-enable button
          if (data.success) {
            // Load the code into the editor
            editor.setValue(data.code, -1); // -1 moves cursor to the beginning
            updateMessageArea("Verilog code imported successfully.", "success");
          } else {
            updateMessageArea("Failed to import Verilog code: " + data.error, "danger");
          }
        },
        error: (jqXHR, textStatus, errorThrown) => {
          $("#import-verilog-button").prop("disabled", false); // Re-enable button
          updateMessageArea("Error communicating with the server: " + errorThrown, "danger");
        },
      });
    } else {
      updateMessageArea("No file selected.", "danger");
    }
  });

  // Gate selection
  $("#gate-selection button").on("click", function () {
    const buttonId = $(this).attr("id");
    selectedGateType = buttonId.split("-")[0]; // 'pi', 'po', 'inv', 'buf', 'and', etc.
    $("#gate-selection button").removeClass("active");

    if (selectedGateType === "cancel") {
      cancelPlacement();
    } else {
      $(this).addClass("active");

      if (selectedGateType === "delete") {
        updateMessageArea("Select a gate to delete.", "info");
      } else if (selectedGateType === "connect") {
        updateMessageArea("Select the source gate to connect.", "info");
      } else {
        updateMessageArea(
          `Selected ${selectedGateType.toUpperCase()} gate. Click on a tile to place.`,
          "info",
        );
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
    cy.nodes().removeClass("highlighted");

    // Update UI
    $("#gate-selection button").removeClass("active");
    updateMessageArea("Action cancelled.", "secondary");
  }

  // Message area update function
  function updateMessageArea(message, type = "info") {
    $("#message-area")
      .removeClass()
      .addClass(`alert alert-${type} text-center`)
      .text(message);
  }

  // Handle layout creation
  $("#layout-form").on("submit", function (event) {
    event.preventDefault();
    const xDimension = parseInt($("#x-dimension").val());
    const yDimension = parseInt($("#y-dimension").val());

    // Send the new dimensions to the server
    $.ajax({
      url: "/create_layout",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ x: xDimension, y: yDimension }),
      success: (data) => {
        if (data.success) {
          createGridNodes(xDimension, yDimension);
          updateMessageArea(
            "Layout resized successfully. Existing gates are preserved.",
            "success",
          );
        } else {
          updateMessageArea("Failed to resize layout: " + data.error, "danger");
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        updateMessageArea("Error resizing layout: " + errorThrown, "danger");
      },
    });
  });

  function createGridNodes(newX, newY) {
    const existingNodes = cy.nodes();

    // Remove nodes outside the new dimensions
    existingNodes.forEach((node) => {
      const x = node.data("x");
      const y = node.data("y");
      if (x >= newX || y >= newY) {
        cy.remove(node);
      }
    });

    // Add new nodes if necessary
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
              label: "", // Gate label, initially empty
              x: i,
              y: j,
              tileNumber: tileNumber,
              color: tileColor,
              hasGate: false,
            },
            position: { x: i * 60, y: j * 60 },
            locked: true,
          });

          // Add tile number as background image
          const newNode = cy.getElementById(nodeId);
          newNode.style({
            "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
              createTileNumberSVG(tileNumber),
            )}`,
            "background-width": "100%",
            "background-height": "100%",
            "background-position": "bottom right",
            "background-repeat": "no-repeat",
            "background-clip": "none",
          });
        }
      }
    }

    // Update the layout dimensions
    layoutDimensions.x = newX;
    layoutDimensions.y = newY;

    // Re-apply the layout
    cy.layout({ name: "preset" }).run();
    cy.fit();
  }

  function createTileNumberSVG(number) {
    // Determine the text color based on the tile number
    const textColor = number === 1 || number === 2 ? "#000000" : "#ffffff"; // Black for 1 and 2, white for 3 and 4

    return `
            <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
                <text x="45" y="45" text-anchor="end" alignment-baseline="baseline" font-size="10" fill="${textColor}">${number}</text>
            </svg>
        `;
  }

  // In handlePlaceGate function, check for PI gate
  function handlePlaceGate() {
    if (selectedNode.data("hasGate")) {
      updateMessageArea("Cannot place a gate on a non-empty tile.", "danger");
      selectedNode = null;
      return;
    }
    if (selectedGateType !== "pi") {
      updateMessageArea("Invalid action. Please select a PI gate.", "danger");
      selectedNode = null;
      return;
    }
    // Proceed to place PI gate
    placeGate(selectedNode.data("x"), selectedNode.data("y"), "pi", {})
      .then(() => {
        updateMessageArea("PI gate placed successfully.", "success");
        selectedNode = null;
      })
      .catch(() => {
        selectedNode = null;
      });
  }

  // Handle gate placement
  function handleGatePlacement(node) {
    if (!selectedNode) {
      selectedNode = node;
      if (selectedNode.data("hasGate")) {
        updateMessageArea("Cannot place a gate on a non-empty tile.", "danger");
        selectedNode = null;
        return;
      }
      if (["buf", "inv", "po"].includes(selectedGateType)) {
        updateMessageArea(
          `Selected node (${node.data("x")},${node.data(
            "y",
          )}) to place ${selectedGateType.toUpperCase()} gate. Now select an adjacent incoming signal node.`,
          "info",
        );
      } else if (
        ["and", "or", "nor", "xor", "xnor"].includes(selectedGateType)
      ) {
        updateMessageArea(
          `Selected node (${node.data("x")},${node.data(
            "y",
          )}) to place ${selectedGateType.toUpperCase()} gate. Now select the first adjacent incoming signal node.`,
          "info",
        );
      }
    } else {
      if (["buf", "inv", "po"].includes(selectedGateType)) {
        handleSingleInputGatePlacement(node);
      } else if (
        ["and", "or", "nor", "xor", "xnor"].includes(selectedGateType)
      ) {
        handleDualInputGatePlacement(node);
      }
    }
  }

  // Handle single input gates (BUF, INV, PO)
  function handleSingleInputGatePlacement(node) {
    if (!node.data("hasGate")) {
      updateMessageArea("The incoming signal node must have a gate.", "danger");
      return;
    }
    if (!areNodesAdjacentCardinal(selectedNode, node)) {
      updateMessageArea(
        "Please select an adjacent node (left, right, top, bottom) as the incoming signal.",
        "danger",
      );
      return;
    }
    if (!isValidTileTransition(node, selectedNode)) {
      updateMessageArea(
        "Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.",
        "danger",
      );
      return;
    }

    // Check if the target node already has maximum inputs
    const existingInEdges = selectedNode
      .connectedEdges()
      .filter((edge) => edge.data("target") === selectedNode.id());
    const maxInputs = 1;

    if (existingInEdges.length >= maxInputs) {
      updateMessageArea(
        `Gate at (${selectedNode.data("x")}, ${selectedNode.data(
          "y",
        )}) cannot have more than ${maxInputs} incoming signals.`,
        "danger",
      );
      selectedNode = null;
      return;
    }

    selectedSourceNode = node;
    // Highlight the selected source node
    selectedSourceNode.addClass("highlighted");
    placeSingleInputGate();
  }

  function placeSingleInputGate() {
    const gateX = selectedNode.data("x");
    const gateY = selectedNode.data("y");

    placeGate(gateX, gateY, selectedGateType, {
      first: {
        position: {
          x: selectedSourceNode.data("x"),
          y: selectedSourceNode.data("y"),
        },
      },
    })
      .then(() => {
        // Only add the edge if the gate was placed successfully
        cy.add({
          group: "edges",
          data: {
            id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
            source: selectedSourceNode.id(),
            target: selectedNode.id(),
          },
        });

        // Remove highlight from source node
        selectedSourceNode.removeClass("highlighted");

        // Update gate labels
        updateGateLabels();

        updateMessageArea(
          `${selectedGateType.toUpperCase()} gate placed successfully.`,
          "success",
        );

        selectedNode = null;
        selectedSourceNode = null;
      })
      .catch(() => {
        // Remove highlight from source node in case of failure
        selectedSourceNode.removeClass("highlighted");
        selectedNode = null;
        selectedSourceNode = null;
      });
  }

  // Handle dual input gates (AND, OR, NOR, XOR, XNOR)
  function handleDualInputGatePlacement(node) {
    if (!node.data("hasGate")) {
      updateMessageArea("The incoming signal node must have a gate.", "danger");
      return;
    }

    // Check if the target node already has maximum inputs
    const existingInEdges = selectedNode
      .connectedEdges()
      .filter((edge) => edge.data("target") === selectedNode.id());
    const maxInputs = 2;

    if (existingInEdges.length >= maxInputs) {
      updateMessageArea(
        `Gate at (${selectedNode.data("x")}, ${selectedNode.data(
          "y",
        )}) cannot have more than ${maxInputs} incoming signals.`,
        "danger",
      );
      selectedNode = null;
      if (selectedSourceNode) selectedSourceNode.removeClass("highlighted");
      selectedSourceNode = null;
      return;
    }

    if (!areNodesAdjacentCardinal(selectedNode, node)) {
      updateMessageArea(
        "Please select an adjacent node (left, right, top, bottom) as the incoming signal.",
        "danger",
      );
      return;
    }
    if (!isValidTileTransition(node, selectedNode)) {
      updateMessageArea(
        "Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.",
        "danger",
      );
      return;
    }

    if (!selectedSourceNode) {
      selectedSourceNode = node;
      // Highlight the first selected source node
      selectedSourceNode.addClass("highlighted");
      updateMessageArea(
        "Now select the second adjacent incoming signal node.",
        "info",
      );
    } else if (!selectedSourceNode2) {
      if (node.id() === selectedSourceNode.id()) {
        updateMessageArea(
          "The second incoming signal cannot be the same as the first.",
          "danger",
        );
        return;
      }
      selectedSourceNode2 = node;
      // Highlight the second selected source node
      selectedSourceNode2.addClass("highlighted");
      placeDualInputGate();
    }
  }

  function placeDualInputGate() {
    const gateX = selectedNode.data("x");
    const gateY = selectedNode.data("y");

    placeGate(gateX, gateY, selectedGateType, {
      first: {
        position: {
          x: selectedSourceNode.data("x"),
          y: selectedSourceNode.data("y"),
        },
      },
      second: {
        position: {
          x: selectedSourceNode2.data("x"),
          y: selectedSourceNode2.data("y"),
        },
      },
    })
      .then(() => {
        // Only add the edges if the gate was placed successfully
        cy.add([
          {
            group: "edges",
            data: {
              id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
              source: selectedSourceNode.id(),
              target: selectedNode.id(),
            },
          },
          {
            group: "edges",
            data: {
              id: `edge-${selectedSourceNode2.id()}-${selectedNode.id()}`,
              source: selectedSourceNode2.id(),
              target: selectedNode.id(),
            },
          },
        ]);

        // Remove highlights from source nodes
        selectedSourceNode.removeClass("highlighted");
        selectedSourceNode2.removeClass("highlighted");

        // Update gate labels
        updateGateLabels();

        updateMessageArea(
          `${selectedGateType.toUpperCase()} gate placed successfully.`,
          "success",
        );

        selectedNode = null;
        selectedSourceNode = null;
        selectedSourceNode2 = null;
      })
      .catch(() => {
        // Remove highlights from source nodes in case of failure
        if (selectedSourceNode) selectedSourceNode.removeClass("highlighted");
        if (selectedSourceNode2) selectedSourceNode2.removeClass("highlighted");
        selectedNode = null;
        selectedSourceNode = null;
        selectedSourceNode2 = null;
      });
  }

  // Check if nodes are adjacent in cardinal directions (no diagonals)
  function areNodesAdjacentCardinal(nodeA, nodeB) {
    const x1 = nodeA.data("x");
    const y1 = nodeA.data("y");
    const x2 = nodeB.data("x");
    const y2 = nodeB.data("y");

    const dx = x1 - x2;
    const dy = y1 - y2;

    // Check for adjacency in cardinal directions
    return (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1);
  }

  // Check if tile numbers satisfy the specific sequence
  function isValidTileTransition(sourceNode, targetNode) {
    const sourceNumber = sourceNode.data("tileNumber");
    const targetNumber = targetNode.data("tileNumber");

    return (
      (sourceNumber === 1 && targetNumber === 2) ||
      (sourceNumber === 2 && targetNumber === 3) ||
      (sourceNumber === 3 && targetNumber === 4) ||
      (sourceNumber === 4 && targetNumber === 1)
    );
  }

  // Modified placeGate function to return a Promise
  function placeGate(x, y, gateType, params) {
    return new Promise((resolve, reject) => {
      $.ajax({
        url: "/place_gate",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({
          x: parseInt(x),
          y: parseInt(y),
          gate_type: gateType,
          params: params,
        }),
        success: (data) => {
          if (data.success) {
            const node = cy.getElementById(`node-${x}-${y}`);
            node.data("label", `${gateType.toUpperCase()}`);
            node.data("hasGate", true);

            // Apply custom colors based on the gate type
            let gateColor = node.data("color"); // Default to tile color

            switch (gateType) {
              case "pi":
                gateColor = "lightgreen";
                break;
              case "po":
                gateColor = "lightblue";
                break;
              case "inv":
                gateColor = "lightcoral";
                break;
              case "buf":
                gateColor = "palegoldenrod";
                break;
              case "and":
                gateColor = "lightpink";
                break;
              case "or":
                gateColor = "lightyellow";
                break;
              case "nor":
                gateColor = "plum";
                break;
              case "xor":
                gateColor = "lightcyan";
                break;
              case "xnor":
                gateColor = "lavender";
                break;
              default:
                gateColor = node.data("color");
            }

            // Apply the chosen background color
            node.style("background-color", gateColor);

            // Ensure the tile number remains visible
            const tileNumber = node.data("tileNumber");
            node.style({
              "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
                createTileNumberSVG(tileNumber),
              )}`,
              "background-width": "100%",
              "background-height": "100%",
              "background-position": "bottom right",
              "background-repeat": "no-repeat",
              "background-clip": "none",
            });

            // Resolve the Promise after successful placement
            resolve();
          } else {
            updateMessageArea("Failed to place gate: " + data.error, "danger");
            reject();
          }
        },
        error: (jqXHR, textStatus, errorThrown) => {
          updateMessageArea(
            "Error communicating with the server: " + errorThrown,
            "danger",
          );
          reject();
        },
      });
    });
  }

  // Update gate labels and colors based on the number of outgoing connections
  function updateGateLabels() {
    cy.nodes().forEach((node) => {
      const gateType = node.data("label").toLowerCase();
      if (gateType === "buf" || gateType === "fanout") {
        const outEdges = node
          .connectedEdges()
          .filter((edge) => edge.data("source") === node.id());
        if (outEdges.length === 2) {
          node.data("label", "FANOUT");
          node.style("background-color", "orange");
        } else {
          node.data("label", "BUF");
          node.style("background-color", "palegoldenrod");
        }
      }
    });
  }

  function deleteGate(node) {
    const x = node.data("x");
    const y = node.data("y");

    $.ajax({
      url: "/delete_gate",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ x: x, y: y }),
      success: (data) => {
        if (data.success) {
          // Remove connected edges
          const connectedEdges = node.connectedEdges();
          cy.remove(connectedEdges);

          // Reset node label and style
          node.data("label", "");
          node.data("hasGate", false);
          node.style("background-color", node.data("color"));

          // Update gate labels after deletion
          updateGateLabels();

          updateMessageArea("Gate deleted successfully.", "success");
        } else {
          updateMessageArea("Failed to delete gate: " + data.error, "danger");
        }
      },
      error: () => {
        updateMessageArea("Error communicating with the server.", "danger");
      },
    });
  }

  // Connect two existing gates
  function handleConnectGates(node) {
    if (!selectedSourceNode) {
      if (!node.data("hasGate")) {
        updateMessageArea("Please select a gate as the source.", "danger");
        return;
      }
      selectedSourceNode = node;
      selectedSourceNode.addClass("highlighted");
      updateMessageArea("Now select the target gate to connect.", "info");
    } else if (!selectedNode) {
      if (!node.data("hasGate")) {
        updateMessageArea("Please select a gate as the target.", "danger");
        return;
      }
      if (node.id() === selectedSourceNode.id()) {
        updateMessageArea("Cannot connect a gate to itself.", "danger");
        return;
      }
      if (!areNodesAdjacentCardinal(selectedSourceNode, node)) {
        updateMessageArea(
          "Gates must be adjacent (left, right, top, bottom) to connect.",
          "danger",
        );
        selectedSourceNode.removeClass("highlighted");
        selectedSourceNode = null;
        return;
      }
      if (!isValidTileTransition(selectedSourceNode, node)) {
        updateMessageArea(
          "Invalid tile number sequence. Only transitions 1→2, 2→3, 3→4, and 4→1 are allowed.",
          "danger",
        );
        selectedSourceNode.removeClass("highlighted");
        selectedSourceNode = null;
        return;
      }
      selectedNode = node;
      selectedNode.addClass("highlighted");

      // Create connection
      connectGates();
    }
  }

  function connectGates() {
    const sourceX = selectedSourceNode.data("x");
    const sourceY = selectedSourceNode.data("y");
    const targetX = selectedNode.data("x");
    const targetY = selectedNode.data("y");

    // Check if the source node can have more outgoing connections
    const existingOutEdges = selectedSourceNode
      .connectedEdges()
      .filter((edge) => edge.data("source") === selectedSourceNode.id());
    let maxFanouts = 1;
    const gateType = selectedSourceNode.data("label").toLowerCase();

    if (gateType === "po") {
      maxFanouts = 0;
    } else if (gateType === "buf" || gateType === "fanout") {
      maxFanouts = 2;
    }

    if (existingOutEdges.length >= maxFanouts) {
      updateMessageArea(
        `Gate at (${sourceX}, ${sourceY}) cannot have more than ${maxFanouts} outgoing connections.`,
        "danger",
      );
      selectedSourceNode.removeClass("highlighted");
      selectedNode.removeClass("highlighted");
      selectedSourceNode = null;
      selectedNode = null;
      return;
    }

    // Proceed to connect
    $.ajax({
      url: "/connect_gates",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        source_x: sourceX,
        source_y: sourceY,
        target_x: targetX,
        target_y: targetY,
      }),
      success: (data) => {
        if (data.success) {
          cy.add({
            group: "edges",
            data: {
              id: `edge-${selectedSourceNode.id()}-${selectedNode.id()}`,
              source: selectedSourceNode.id(),
              target: selectedNode.id(),
            },
          });

          // Update gate labels after adding the edge
          updateGateLabels();

          updateMessageArea("Gates connected successfully.", "success");
        } else {
          updateMessageArea("Failed to connect gates: " + data.error, "danger");
        }
        selectedSourceNode.removeClass("highlighted");
        selectedNode.removeClass("highlighted");
        selectedSourceNode = null;
        selectedNode = null;
      },
      error: () => {
        updateMessageArea("Error communicating with the server.", "danger");
        selectedSourceNode.removeClass("highlighted");
        selectedNode.removeClass("highlighted");
        selectedSourceNode = null;
        selectedNode = null;
      },
    });
  }

  // Check Design Rules
  $("#check-rules-button").on("click", function () {
    $.ajax({
      url: "/check_design_rules",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({}),
      success: (data) => {
        if (data.success) {
          displayViolations(data.violations);
        } else {
          updateMessageArea(
            "Failed to check design rules: " + data.error,
            "danger",
          );
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        updateMessageArea(
          "Error communicating with the server: " + errorThrown,
          "danger",
        );
      },
    });
  });

  function displayViolations(violations) {
    const violationsArea = $("#violations-area");
    const violationsList = $("#violations-list");

    // Clear previous violations
    violationsList.empty();

    if (violations.length === 0) {
      violationsArea.removeClass("alert-warning").addClass("alert-success");
      violationsArea.find("h5").text("No Design Rule Violations Found.");
      violationsArea.removeClass("d-none");
    } else {
      violationsArea.removeClass("alert-success").addClass("alert-warning");
      violationsArea.find("h5").text("Design Rule Violations:");
      violations.forEach((violation) => {
        violationsList.append(`<li>${violation}</li>`);
      });
      violationsArea.removeClass("d-none");
    }
  }

  // Export Layout
  $("#export-button").on("click", function () {
    // Show a loading spinner or disable the button during the download
    $("#export-button").prop("disabled", true);

    // Trigger the download
    window.location.href = "/export_layout";

    // Re-enable the button after a delay (or based on another event like download completion)
    setTimeout(function () {
      $("#export-button").prop("disabled", false);
    }, 3000); // Adjust this delay based on the expected download time
  });

  // Trigger file input when the import button is clicked
  $("#import-button").on("click", function () {
    $("#import-file-input").click(); // Trigger file input dialog
  });

  // Handle File Selection and upload it
  $("#import-file-input").on("change", function () {
    const file = this.files[0]; // Get the selected file
    if (file) {
      const formData = new FormData();
      // Append the file with the key 'file' (as expected by the backend)
      formData.append("file", file);

      // Disable the button and show a loading message
      $("#import-button").prop("disabled", true);
      updateMessageArea("Uploading layout...", "info");

      $.ajax({
        url: "/import_layout",
        type: "POST",
        data: formData,
        processData: false, // Prevent jQuery from processing the data
        contentType: false, // Let the browser set the correct content type
        success: (data) => {
          $("#import-button").prop("disabled", false); // Re-enable button
          if (data.success) {
            // Reload the layout and show a success message
            loadLayout();
            updateMessageArea("Layout imported successfully.", "success");
          } else {
            updateMessageArea(
              "Failed to import layout: " + data.error,
              "danger",
            );
          }
        },
        error: (jqXHR, textStatus, errorThrown) => {
          $("#import-button").prop("disabled", false); // Re-enable button
          updateMessageArea(
            "Error communicating with the server: " + errorThrown,
            "danger",
          );
        },
      });
    } else {
      updateMessageArea("No file selected.", "danger");
    }
  });

  function loadLayout() {
    $.ajax({
      url: "/get_layout",
      type: "GET",
      success: (data) => {
        if (data.success) {
          // Clear existing elements
          cy.elements().remove();

          // Recreate the grid
          createGridNodes(data.layoutDimensions.x, data.layoutDimensions.y);

          // Place gates and connections based on the layout data
          data.gates.forEach((gate) => {
            // Place the gate
            placeGateLocally(gate.x, gate.y, gate.type);

            // Handle connections (edges)
            gate.connections.forEach((conn) => {
              cy.add({
                group: "edges",
                data: {
                  id: `edge-node-${conn.sourceX}-${conn.sourceY}-node-${gate.x}-${gate.y}`,
                  source: `node-${conn.sourceX}-${conn.sourceY}`,
                  target: `node-${gate.x}-${gate.y}`,
                },
              });
            });
          });

          // Update gate labels after loading
          updateGateLabels();

          updateMessageArea("Layout loaded successfully.", "success");
        } else {
          updateMessageArea(
            "No existing layout found. Please create a new layout.",
            "info",
          );
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        updateMessageArea(
          "Error communicating with the server: " + errorThrown,
          "danger",
        );
      },
    });
  }

  function placeGateLocally(x, y, gateType) {
    const node = cy.getElementById(`node-${x}-${y}`);
    node.data("label", `${gateType.toUpperCase()}`);
    node.data("hasGate", true);

    // Apply custom colors based on the gate type
    let gateColor = node.data("color"); // Default to tile color

    switch (gateType) {
      case "pi":
        gateColor = "lightgreen";
        break;
      case "po":
        gateColor = "lightblue";
        break;
      case "inv":
        gateColor = "lightcoral";
        break;
      case "buf":
        gateColor = "palegoldenrod";
        break;
      case "fanout":
        gateColor = "orange";
        break;
      case "and":
        gateColor = "lightpink";
        break;
      case "or":
        gateColor = "lightyellow";
        break;
      case "nor":
        gateColor = "plum";
        break;
      case "xor":
        gateColor = "lightcyan";
        break;
      case "xnor":
        gateColor = "lavender";
        break;
      default:
        gateColor = node.data("color");
    }

    // Apply the chosen background color
    node.style("background-color", gateColor);

    // Ensure the tile number remains visible
    const tileNumber = node.data("tileNumber");
    node.style({
      "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
        createTileNumberSVG(tileNumber),
      )}`,
      "background-width": "100%",
      "background-height": "100%",
      "background-position": "bottom right",
      "background-repeat": "no-repeat",
      "background-clip": "none",
    });
  }
});
