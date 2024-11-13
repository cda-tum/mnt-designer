$(document).ready(() => {
  let selectedGateType = null;
  let selectedNode = null;
  let selectedSourceNode = null;
  let selectedSourceNode2 = null;
  let cy = null;
  let valid_verilog = false;
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
  editor.session.on(
    "change",
    debounce(function () {
      let code = editor.getValue();
      $.ajax({
        url: "/save_verilog_code",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({ code: code }),
        success: function (data) {
          if (!data.success) {
            updateMessageArea(
              "Failed to save verilog: " + data.error,
              "danger",
            );
            valid_verilog = false;
          } else {
            updateMessageArea("Updated verilog", "info");
            valid_verilog = true;
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          updateMessageArea(
            "Error communicating with the server: " + errorThrown,
            "danger",
          );
        },
      });
    }, 1000),
  );

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
      userZoomingEnabled: true, // Allow zooming
      userPanningEnabled: true, // Allow panning
      wheelSensitivity: 0.5, // Adjust zoom speed (optional)
      boxSelectionEnabled: false,
      panningEnabled: true, // Enable panning
      autoungrabify: true, // Nodes cannot be grabbed (dragged)
      autounselectify: true, // Nodes cannot be selected
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
          handleZeroInputGatePlacement();
          break;
        case "buf":
        case "bufc":
        case "bufk":
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
        case "move":
          handleMoveGate(node);
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

  // Load the editor from the backend
  loadEditor();

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

    // **Update the form input fields with the current layout dimensions**
    $("#x-dimension").val(layoutDimensions.x);
    $("#y-dimension").val(layoutDimensions.y);

    // Fit the Cytoscape view to the new layout
    cy.fit();
  }

  cy.nodes().ungrabify();

  // Panning using arrow keys
  document.addEventListener("keydown", function (event) {
    const panAmount = 50; // Adjust this value to change pan speed
    if (event.key === "ArrowLeft") {
      cy.panBy({ x: panAmount, y: 0 });
      event.preventDefault(); // Prevent the default scrolling behavior
    } else if (event.key === "ArrowRight") {
      cy.panBy({ x: -panAmount, y: 0 });
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      cy.panBy({ x: 0, y: panAmount });
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      cy.panBy({ x: 0, y: -panAmount });
      event.preventDefault();
    }
  });

  // Zoom In Button
  $("#zoom-in").on("click", function () {
    let zoomLevel = cy.zoom();
    cy.zoom({
      level: zoomLevel * 1.2, // Increase zoom by 20%
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }, // Zoom towards the center
    });
  });

  // Zoom Out Button
  $("#zoom-out").on("click", function () {
    let zoomLevel = cy.zoom();
    cy.zoom({
      level: zoomLevel * 0.8, // Decrease zoom by 20%
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }, // Zoom towards the center
    });
  });

  // Reset Zoom Button
  $("#reset-zoom").on("click", function () {
    cy.fit(); // Reset zoom to fit the entire layout in view
  });

  // Ortho Button Click Handler
  $("#ortho-button").on("click", function () {
    // Disable the button to prevent multiple clicks
    $("#ortho-button").prop("disabled", true);
    updateMessageArea("Applying ortho...", "info");

    if (!valid_verilog) {
      $("#ortho-button").prop("disabled", false);
      updateMessageArea("Verilog not valid", "danger");
      return;
    }

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
          updateMessageArea(
            "Created layout with ortho successfully.",
            "success",
          );
        } else {
          updateMessageArea(
            "Failed to create layout using ortho: " + data.error,
            "danger",
          );
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        $("#ortho-button").prop("disabled", false); // Re-enable button
        updateMessageArea(
          "Error communicating with the server: " + errorThrown,
          "danger",
        );
      },
    });
  });

  // Ortho Button Click Handler
  $("#iosdn-button").on("click", function () {
    // Disable the button to prevent multiple clicks
    $("#iosdn-button").prop("disabled", true);
    updateMessageArea("Applying input-ordering SDN...", "info");

    if (!valid_verilog) {
      $("#iosdn-button").prop("disabled", false);
      updateMessageArea("Verilog not valid", "danger");
      return;
    }

    $.ajax({
      url: "/apply_iosdn",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({}),
      success: (data) => {
        $("#iosdn-button").prop("disabled", false); // Re-enable button
        if (data.success) {
          // Update the layout with the new data
          updateLayout(data.layoutDimensions, data.gates);
          updateMessageArea(
              "Created layout with input-ordering SDN successfully.",
              "success",
          );
        } else {
          updateMessageArea(
              "Failed to create layout using input-ordering SDN: " + data.error,
              "danger",
          );
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        $("#iosdn-button").prop("disabled", false); // Re-enable button
        updateMessageArea(
            "Error communicating with the server: " + errorThrown,
            "danger",
        );
      },
    });
  });

  // Gold Button Click Event (opens modal automatically due to data-bs-toggle)
  $("#apply-gold").on("click", function () {
    // Disable the apply button to prevent multiple clicks
    $("#apply-gold").prop("disabled", true);
    updateMessageArea("Applying gold...", "info");

    if (!valid_verilog) {
      $("#apply-gold").prop("disabled", false);
      updateMessageArea("Verilog not valid", "danger");
      return;
    }

    // Collect the parameter values from the modal form
    // Return Layout Option
    const return_first =
      $("input[name='gold-return-first']:checked").val() === "true";

    // Effort Mode
    const mode = $("input[name='gold-mode']:checked").val();

    // Timeout (ms)
    const timeout = parseInt($("#gold-timeout").val(), 10);

    // Number of Vertex Expansions
    const num_vertex_expansions = parseInt(
      $("#gold-num-vertex-expansions").val(),
      10,
    );

    // Planar Option
    const planar = $("input[name='gold-planar']:checked").val() === "true";

    // Cost Metric (Remains as Select)
    const cost = $("#gold-cost").val();

    // Enable Multithreading
    const enable_multithreading =
      $("input[name='gold-enable-multithreading']:checked").val() === "true";

    // Validate parameters (optional)
    if (
      isNaN(timeout) ||
      timeout < 1 ||
      timeout > 10000 ||
      isNaN(num_vertex_expansions) ||
      num_vertex_expansions < 1 ||
      num_vertex_expansions > 100
    ) {
      updateMessageArea(
        "Invalid input. Please check timeout and number of vertex expansions.",
        "danger",
      );
      $("#apply-gold").prop("disabled", false);
      return;
    }

    // Create a data object with parameters to be sent
    const requestData = {
      return_first: return_first,
      mode: mode,
      timeout: timeout,
      num_vertex_expansions: num_vertex_expansions,
      planar: planar,
      cost: cost,
      enable_multithreading: enable_multithreading,
    };

    // Send the parameters with the AJAX request
    $.ajax({
      url: "/apply_gold", // Backend route for the Gold algorithm
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(requestData), // Send the parameters as JSON
      success: function (data) {
        $("#apply-gold").prop("disabled", false);
        if (data.success) {
          // Update the layout with the new data after the Gold algorithm is applied
          updateLayout(data.layoutDimensions, data.gates);
          updateMessageArea("gold algorithm applied successfully.", "success");
          $("#goldModal").modal("hide"); // Close the modal
        } else {
          updateMessageArea(
            "Failed to create layout using gold: " + data.error,
            "danger",
          );
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        $("#apply-gold").prop("disabled", false);
        updateMessageArea(
          "Error applying gold algorithm: " + errorThrown,
          "danger",
        );
      },
    });
  });

  // Exact Algorithm Apply Button Click Event
  $("#apply-exact").on("click", function () {
    // Disable the apply button to prevent multiple clicks
    $("#apply-exact").prop("disabled", true);
    updateMessageArea("Applying exact algorithm...", "info");

    if (!valid_verilog) {
      $("#apply-exact").prop("disabled", false);
      updateMessageArea("Verilog not valid", "danger");
      return;
    }

    // Collect the parameter values from the modal form
    // Upper Bound X
    const upper_bound_x = parseInt($("#exact-upper-bound-x").val(), 10) || 1000;

    // Upper Bound Y
    const upper_bound_y = parseInt($("#exact-upper-bound-y").val(), 10) || 1000;

    // Fixed Size
    const fixed_size = $("input[name='exact-fixed-size']:checked").val() === "true";

    // Number of Threads
    const num_threads = parseInt($("#exact-num-threads").val(), 10) || 1;

    // Crossings
    const crossings = $("input[name='exact-crossings']:checked").val() === "true";

    // Border IO
    const border_io = $("input[name='exact-border-io']:checked").val() === "true";

    // Straight Inverters
    const straight_inverters =
        $("input[name='exact-straight-inverters']:checked").val() === "true";

    // Desynchronize
    const desynchronize = $("input[name='exact-desynchronize']:checked").val() === "true";

    // Minimize Wires
    const minimize_wires = $("input[name='exact-minimize-wires']:checked").val() === "true";

    // Minimize Crossings
    const minimize_crossings =
        $("input[name='exact-minimize-crossings']:checked").val() === "true";

    // Timeout
    const timeout = parseInt($("#exact-timeout").val(), 10) || 4294967;

    // Create a data object with parameters to be sent
    const requestData = {
      upper_bound_x: upper_bound_x,
      upper_bound_y: upper_bound_y,
      fixed_size: fixed_size,
      num_threads: num_threads,
      crossings: crossings,
      border_io: border_io,
      straight_inverters: straight_inverters,
      desynchronize: desynchronize,
      minimize_wires: minimize_wires,
      minimize_crossings: minimize_crossings,
      timeout: timeout,
    };

    // Send the parameters with the AJAX request
    $.ajax({
      url: "/apply_exact", // Backend route for the exact algorithm
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(requestData), // Send the parameters as JSON
      success: function (data) {
        $("#apply-exact").prop("disabled", false);
        if (data.success) {
          // Update the layout with the new data after the exact algorithm is applied
          updateLayout(data.layoutDimensions, data.gates);
          updateMessageArea("Exact algorithm applied successfully.", "success");
          $("#exactModal").modal("hide"); // Close the modal
        } else {
          updateMessageArea(
              "Failed to create layout using exact algorithm: " + data.error,
              "danger"
          );
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        $("#apply-exact").prop("disabled", false);
        updateMessageArea(
            "Error applying exact algorithm: " + errorThrown,
            "danger"
        );
      },
    });
  });

  function toggleCustomRelocations() {
    const selectedValue = $("input[name='max-gate-relocations']:checked").val();
    if (selectedValue === "custom") {
      $("#custom-relocations-input").removeClass("d-none");
    } else {
      $("#custom-relocations-input").addClass("d-none");
      // Optionally, reset the custom input value when hidden
      $("#custom-max-gate-relocations").val("");
    }
  }

  // Initial check on page load
  toggleCustomRelocations();

  // Event listener for changes in Max Gate Relocations
  $("input[name='max-gate-relocations']").on("change", toggleCustomRelocations);

  // Event listener for the "Optimize" button
  $("#apply-optimization").on("click", function () {
    // Disable the apply button to prevent multiple clicks
    $("#apply-optimization").prop("disabled", true).text("Applying...");

    // Collect parameters
    let maxGateRelocations = $(
      "input[name='max-gate-relocations']:checked",
    ).val();
    let customRelocations = null;
    if (maxGateRelocations === "custom") {
      customRelocations =
        parseInt($("#custom-max-gate-relocations").val(), 10) || 0;
    }

    // Optimize PO Positions Only
    const optimizePosOnly =
      $("input[name='optimize-pos-only']:checked").val() === "true";

    // Planar Optimization
    const planarOptimization =
      $("input[name='planar-optimization']:checked").val() === "true";

    // Timeout
    const timeout = parseInt($("#optimization-timeout").val(), 10);

    // Validate Timeout
    if (isNaN(timeout) || timeout < 1 || timeout > 10000) {
      updateMessageArea(
        "Invalid timeout value. Please enter a number between 1 and 10000.",
        "danger",
      );
      $("#apply-optimization").prop("disabled", false).text("Optimize");
      return;
    }

    // If "Custom" is selected, ensure custom relocations is a valid number
    if (maxGateRelocations === "custom") {
      if (isNaN(customRelocations) || customRelocations < 0) {
        updateMessageArea(
          "Invalid custom relocations value. Please enter a non-negative number.",
          "danger",
        );
        $("#apply-optimization").prop("disabled", false).text("Optimize");
        return;
      }
    }

    // Create a data object with parameters to be sent
    const requestData = {
      max_gate_relocations: customRelocations, // None for max, else int
      optimize_pos_only: optimizePosOnly,
      planar_optimization: planarOptimization,
      timeout: timeout,
    };

    // Send the parameters with the AJAX request
    $.ajax({
      url: "/apply_optimization", // Backend route for the optimization algorithm
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(requestData), // Send the parameters as JSON
      success: function (data) {
        $("#apply-optimization").prop("disabled", false).text("Optimize");
        if (data.success) {
          // Update the layout with the new data after the optimization algorithm is applied
          updateLayout(data.layoutDimensions, data.gates);
          updateMessageArea("Layout was optimized successfully.", "success");
          $("#optimizationModal").modal("hide"); // Close the modal
        } else {
          updateMessageArea(
            "Failed to optimize layout: " + data.error,
            "danger",
          );
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        $("#apply-optimization").prop("disabled", false).text("Optimize");
        updateMessageArea("Error optimizing layout: " + errorThrown, "danger");
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
            valid_verilog = true;
          } else {
            updateMessageArea(
              "Failed to import Verilog code: " + data.error,
              "danger",
            );
          }
        },
        error: (jqXHR, textStatus, errorThrown) => {
          $("#import-verilog-button").prop("disabled", false); // Re-enable button
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

  // Handle layout creation with bounding box check
  $("#layout-form").on("submit", function (event) {
    event.preventDefault();

    const xDimension = parseInt($("#x-dimension").val());
    const yDimension = parseInt($("#y-dimension").val());

    // Frontend validation to ensure positive integers
    if (
      isNaN(xDimension) ||
      isNaN(yDimension) ||
      xDimension <= 0 ||
      yDimension <= 0
    ) {
      updateMessageArea(
        "Please enter valid positive integers for dimensions.",
        "warning",
      );
      return;
    }

    // Disable the resize button to prevent multiple submissions
    $("#resize-button").prop("disabled", true);

    // First, fetch the current bounding box from the backend
    $.ajax({
      url: "/get_bounding_box",
      type: "GET",
      dataType: "json",
      success: function (data) {
        if (data.success) {
          const currentMaxX = data.max_x + 1;
          const currentMaxY = data.max_y + 1;

          // Check if new dimensions are sufficient to accommodate existing gates
          if (xDimension >= currentMaxX && yDimension >= currentMaxY) {
            // Proceed to resize the layout
            $.ajax({
              url: "/create_layout",
              type: "POST",
              contentType: "application/json",
              data: JSON.stringify({ x: xDimension, y: yDimension }),
              success: function (data) {
                if (data.success) {
                  createGridNodes(xDimension, yDimension);
                  updateMessageArea(
                    "Layout resized successfully. Existing gates are preserved.",
                    "success",
                  );

                  // Optionally, update form inputs to reflect the new dimensions
                  $("#x-dimension").val(xDimension);
                  $("#y-dimension").val(yDimension);
                } else {
                  updateMessageArea(
                    "Failed to resize layout: " + data.error,
                    "danger",
                  );
                }
              },
              error: function (jqXHR, textStatus, errorThrown) {
                updateMessageArea(
                  "Error communicating with the server: " + errorThrown,
                  "danger",
                );
              },
              complete: function () {
                // Re-enable the resize button after the request completes
                $("#resize-button").prop("disabled", false);
              },
            });
          } else {
            // New dimensions are smaller than existing gates
            updateMessageArea(
              `Cannot resize layout to (${xDimension}, ${yDimension}) because existing gates are placed up to (${currentMaxX}, ${currentMaxY}). Please remove some gates or choose larger dimensions.`,
              "danger",
            );
            // Re-enable the resize button since the operation is blocked
            $("#resize-button").prop("disabled", false);
          }
        } else {
          // Handle the case where data.success is false (application-level failure)
          updateMessageArea(
            "Failed to fetch bounding box: " + data.error,
            "danger",
          );
          // Re-enable the resize button
          $("#resize-button").prop("disabled", false);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        updateMessageArea(
          "Error fetching current layout: " + errorThrown,
          "danger",
        );
        // Re-enable the resize button in case of error
        $("#resize-button").prop("disabled", false);
      },
    });
  });

  // Handle Reset Layout
  $("#reset-layout-button").on("click", function () {
    // Confirm the reset action with the user
    if (
      !confirm(
        "Are you sure you want to reset the layout? This will remove all gates and connections.",
      )
    ) {
      return; // Exit if the user cancels
    }

    // Disable the reset button to prevent multiple clicks
    $("#reset-layout-button").prop("disabled", true);

    // Show a loading message or spinner if desired
    updateMessageArea("Resetting layout...", "info");

    // Send a POST request to the /reset endpoint with current dimensions
    $.ajax({
      url: "/reset_layout",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ x: layoutDimensions.x, y: layoutDimensions.y }),
      success: function (data) {
        if (data.success) {
          // Reload the layout from the backend to reflect the reset
          loadLayout();

          updateMessageArea("Layout has been reset successfully.", "success");
        } else {
          updateMessageArea("Failed to reset layout: " + data.error, "danger");
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        updateMessageArea(
          "Error communicating with the server: " + errorThrown,
          "danger",
        );
      },
      complete: function () {
        // Re-enable the reset button after the request completes
        $("#reset-layout-button").prop("disabled", false);
      },
    });
  });

  // Handle Reset Editor
  $("#reset-editor-button").on("click", function () {
    // Confirm the reset action with the user
    if (
      !confirm(
        "Are you sure you want to reset the editor? This will revert all changes made to the Verilog code.",
      )
    ) {
      return; // Exit if the user cancels
    }

    // Disable the reset editor button to prevent multiple clicks
    $("#reset-editor-button").prop("disabled", true);
    // Optionally, disable other interactive elements or show a spinner
    $("#spinner").removeClass("d-none");
    updateMessageArea("Resetting editor...", "info");

    // Send a POST request to the /reset_editor endpoint
    $.ajax({
      url: "/reset_editor",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({}),
      success: function (data) {
        if (data.success) {
          // Set the editor content to the reset code
          editor.setValue(data.code, -1); // -1 moves cursor to the start
          updateMessageArea("Editor has been reset successfully.", "success");
        } else {
          updateMessageArea("Failed to reset editor: " + data.error, "danger");
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        updateMessageArea(
          "Error communicating with the server: " + errorThrown,
          "danger",
        );
      },
      complete: function () {
        // Re-enable the reset editor button and hide the spinner
        $("#reset-editor-button").prop("disabled", false);
        $("#spinner").addClass("d-none");
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
              gateType: "",
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

  function createTileNumberSVG(number, gateType, orientation) {
    // Determine the text color based on the tile number
    const textColor = number === 1 || number === 2 ? "#000000" : "#ffffff"; // Black for 1 and 2, white for 3 and 4

    // Base SVG template
    const baseSVG = (content) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
        <svg width="50px" height="50px" viewBox="0 0 98 98">
          ${content}
        </svg>
        <text x="45" y="45" text-anchor="end" alignment-baseline="baseline" font-size="10" fill="${textColor}">
          ${number}
        </text>
      </svg>
    `;

    // Functions to draw lines and arrowheads with precise coordinates
    const drawLine = (x1, y1, x2, y2) => {
      return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="black" stroke-width="3"/>`;
    };

    const drawArrowhead = (points) => {
      return `<path d="${points}" fill="black" stroke="black" stroke-width="3"/>`;
    };

    const drawCircle = (cx, cy, r) => {
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black"/>`;
    };

    // Mapping of gateTypes and orientations to SVG content
    const gateSVGContent = {
      bufc: `
      <g>
        ${drawLine(8, 48, 77.9, 48)} <!-- Horizontal Line -->
        ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->

        ${drawLine(48, 8, 48, 77.9)} <!-- Vertical Line -->
        ${drawArrowhead("M 48 84.65 L 43.5 75.65 L 48 77.9 L 52.5 75.65 Z")} <!-- Down Arrowhead -->
      </g>
    `,
      bufk: `
      <g>
        ${drawLine(8, 48, 38, 48)} <!-- Line from Left to Middle -->
        ${drawLine(38, 48, 45.55, 78.2)} <!-- Line to Bottom Right -->
        ${drawArrowhead("M 47.19 84.75 L 40.64 77.11 L 45.55 78.2 L 49.37 74.92 Z")} <!-- Arrowhead at Bottom Right -->

        ${drawLine(48, 8, 58, 48)} <!-- Line from Top to Middle Right -->
        ${drawLine(58, 48, 77.9, 48)} <!-- Line from Middle Right to Right -->
        ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
      </g>
    `,
      buf: {
        TopToBottom: `
        <g>
          ${drawLine(48, 8, 48, 77.9)} <!-- Vertical Line -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
        LeftToRight: `
        <g>
          ${drawLine(8, 48, 77.9, 48)} <!-- Horizontal Line -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
        </g>
      `,
        LeftToBottom: `
        <g>
          ${drawLine(8, 48, 48, 48)} <!-- Line from Left to Middle -->
          ${drawLine(48, 48, 48, 77.9)} <!-- Line from Middle to Bottom -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
        TopToRight: `
        <g>
          ${drawLine(48, 8, 48, 48)} <!-- Line from Top to Middle -->
          ${drawLine(48, 48, 77.9, 48)} <!-- Line from Middle to Right -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
        </g>
      `,
        LeftToMiddle: `
        <g>
          ${drawLine(8, 48, 48, 48)} <!-- Horizontal Line -->
          ${drawArrowhead("M 54.65 48 L 45.65 52.5 L 48 48 L 45.65 43.5 Z")} <!-- Arrowhead at Middle Right -->
        </g>
      `,
        TopToMiddle: `
        <g>
          ${drawLine(48, 8, 48, 48)} <!-- Vertical Line -->
          ${drawArrowhead("M 48 54.65 L 52.5 45.65 L 48 48 L 43.5 45.65 Z")} <!-- Arrowhead at Middle Down -->
        </g>
      `,
        MiddleToRight: `
        <g>
          ${drawLine(48, 48, 77.9, 48)} <!-- Line from Middle to Right -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
        </g>
      `,
        MiddleToBottom: `
        <g>
          ${drawLine(48, 48, 48, 77.9)} <!-- Line from Middle to Bottom -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
        MiddleToMiddle: `
        <g>
          ${drawCircle(48, 48, 4)} <!-- Dot in the middle -->
        </g>
      `,
      },
      fanout: {
        Top: `
        <g>
          ${drawLine(48, 8, 48, 48)} <!-- Vertical Line from Top to Center -->
          ${drawLine(48, 48, 77.9, 48)} <!-- Horizontal Line from Center to Right -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
          ${drawLine(48, 48, 48, 77.9)} <!-- Vertical Line from Center to Bottom -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
        Left: `
        <g>
          ${drawLine(8, 48, 48, 48)} <!-- Horizontal Line from Left to Center -->
          ${drawLine(48, 48, 77.9, 48)} <!-- Horizontal Line from Center to Right -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
          ${drawLine(48, 48, 48, 77.9)} <!-- Vertical Line from Center to Bottom -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
        Middle: `
        <g>
          ${drawLine(48, 48, 77.9, 48)} <!-- Horizontal Line from Center to Right -->
          ${drawArrowhead("M 84.65 48 L 75.65 52.5 L 77.9 48 L 75.65 43.5 Z")} <!-- Right Arrowhead -->
          ${drawLine(48, 48, 48, 77.9)} <!-- Vertical Line from Center to Bottom -->
          ${drawArrowhead("M 48 84.65 L 52.5 75.65 L 48 77.9 L 43.5 75.65 Z")} <!-- Down Arrowhead -->
        </g>
      `,
      },
    };

    // Retrieve the appropriate SVG content based on gateType and orientation
    let content = "";

    if (gateSVGContent[gateType]) {
      if (typeof gateSVGContent[gateType] === "string") {
        content = gateSVGContent[gateType];
      } else if (gateSVGContent[gateType][orientation]) {
        content = gateSVGContent[gateType][orientation];
      }
    } else {
      // Default content if gateType or orientation doesn't match
      content = "";
    }

    // Return the assembled SVG
    return baseSVG(content);
  }

  // In handlePlaceGate function, check for PI gate
  function handleZeroInputGatePlacement() {
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
        ["and", "or", "nor", "xor", "xnor", "bufc", "bufk"].includes(
          selectedGateType,
        )
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
        ["and", "or", "nor", "xor", "xnor", "bufc", "bufk"].includes(
          selectedGateType,
        )
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
    const sourceGateType = selectedSourceNode.data("gateType").toLowerCase();

    placeGate(gateX, gateY, selectedGateType, {
      first: {
        position: {
          x: selectedSourceNode.data("x"),
          y: selectedSourceNode.data("y"),
        },
        gate_type: sourceGateType,
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
    const firstSourceGateType = selectedSourceNode
      .data("gateType")
      .toLowerCase();
    const secondSourceGateType = selectedSourceNode2
      .data("gateType")
      .toLowerCase();

    placeGate(gateX, gateY, selectedGateType, {
      first: {
        position: {
          x: selectedSourceNode.data("x"),
          y: selectedSourceNode.data("y"),
        },
        gate_type: firstSourceGateType,
      },
      second: {
        position: {
          x: selectedSourceNode2.data("x"),
          y: selectedSourceNode2.data("y"),
        },
        gate_type: secondSourceGateType,
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
            node.data("gateType", `${gateType.toUpperCase()}`);
            node.data("hasGate", true);

            if (data.updateFirstBufToFanout) {
              const nodeNode = cy.getElementById(
                `node-${params.first.position.x}-${params.first.position.y}`,
              );
              nodeNode.data("gateType", "fanout");
              nodeNode.data("label", "");
              updateGateLabel(nodeNode);
            }
            if (data.updateSecondBufToFanout) {
              const nodeNode = cy.getElementById(
                `node-${params.second.position.x}-${params.second.position.y}`,
              );
              nodeNode.data("gateType", "fanout");
              nodeNode.data("label", "");
              updateGateLabel(nodeNode);
            }

            updateGateLabel(node);
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

  function updateGateLabel(node) {
    const gateType = node.data("gateType").toLowerCase();
    let gateColor;

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
      case "bufc":
        gateColor = "lightsalmon";
        break;
      case "bufk":
        gateColor = "lightseagreen";
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

    if (gateType === "buf") {
      // Set the label and background image for bufc
      node.data("label", "");
      const nodePosition = node.position();
      const tileNumber = node.data("tileNumber");

      let source = "Middle";
      const inEdges = node
        .connectedEdges()
        .filter((edge) => edge.data("target") === node.id());
      // Loop through each outgoing edge to determine where the connection is coming from
      inEdges.forEach((edge) => {
        const sourceNode = cy.getElementById(edge.data("source"));
        const sourcePosition = sourceNode.position();
        if (sourcePosition.x < nodePosition.x) {
          source = "Left";
        } else if (sourcePosition.y < nodePosition.y) {
          source = "Top";
        } else {
          console.log(sourcePosition, nodePosition);
        }
      });

      let target = "Middle";
      const outEdges = node
        .connectedEdges()
        .filter((edge) => edge.data("source") === node.id());
      // Loop through each outgoing edge to determine where the connection is coming from
      outEdges.forEach((edge) => {
        const targetNode = cy.getElementById(edge.data("target"));
        const targetPosition = targetNode.position();

        if (nodePosition.x < targetPosition.x) {
          target = "Right";
        } else if (nodePosition.y < targetPosition.y) {
          target = "Bottom";
        } else {
          console.log(nodePosition, targetPosition);
        }
      });

      const orientation = source + "To" + target;

      node.style({
        "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
          createTileNumberSVG(tileNumber, gateType, orientation),
        )}`,
        "background-fit": "contain", // Ensure the image fits within the node
      });
    } else if (gateType === "fanout") {
      node.data("label", "");
      const nodePosition = node.position();
      const tileNumber = node.data("tileNumber");

      let source = "Middle";
      const inEdges = node
        .connectedEdges()
        .filter((edge) => edge.data("target") === node.id());
      // Loop through each outgoing edge to determine where the connection is coming from
      inEdges.forEach((edge) => {
        const sourceNode = cy.getElementById(edge.data("source"));
        const sourcePosition = sourceNode.position();
        if (sourcePosition.x < nodePosition.x) {
          source = "Left";
        } else if (sourcePosition.y < nodePosition.y) {
          source = "Top";
        } else {
          console.log(sourcePosition, nodePosition);
        }
      });

      const orientation = source;

      node.style({
        "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
          createTileNumberSVG(tileNumber, gateType, orientation),
        )}`,
        "background-fit": "contain", // Ensure the image fits within the node
      });
    } else if (gateType === "bufc" || gateType === "bufk") {
      // Set the label and background image for bufc
      node.data("label", "");
      const tileNumber = node.data("tileNumber");
      node.style({
        "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
          createTileNumberSVG(tileNumber, gateType),
        )}`,
        "background-fit": "contain", // Ensure the image fits within the node
      });
    } else {
      // Ensure the tile number remains visible
      const tileNumber = node.data("tileNumber");
      node.style({
        "background-image": `data:image/svg+xml;utf8,${encodeURIComponent(
          createTileNumberSVG(tileNumber, gateType),
        )}`,
        "background-width": "100%",
        "background-height": "100%",
        "background-position": "bottom right",
        "background-repeat": "no-repeat",
        "background-clip": "none",
      });
    }
  }

  // Update gate labels and colors based on the number of outgoing connections
  function updateGateLabels() {
    cy.nodes().forEach((node) => {
      updateGateLabel(node);
    });
  }

  function deleteGate(node) {
    const gateType = node.data("gateType").toLowerCase(); // Assuming labels are in uppercase like 'PI'

    // Check if the gate is a PI
    if (gateType === "pi") {
      updateMessageArea("Cannot delete PI gates.", "danger");
      return; // Exit the function to prevent deletion
    }

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
          node.data("gateType", "");
          node.data("hasGate", false);
          node.style("background-color", node.data("color"));

          const inEdges = connectedEdges.filter(
            (edge) => edge.data("target") === node.id(),
          );
          // Loop through each outgoing edge to determine where the connection is coming from
          inEdges.forEach((edge) => {
            const sourceNode = cy.getElementById(edge.data("source"));
            if (sourceNode.data("gateType").toLowerCase() === "fanout") {
              sourceNode.data("gateType", "buf");
            }
            updateGateLabel(sourceNode);
          });

          const outEdges = connectedEdges.filter(
            (edge) => edge.data("source") === node.id(),
          );
          // Loop through each outgoing edge to determine where the connection is coming from
          outEdges.forEach((edge) => {
            const targetNode = cy.getElementById(edge.data("target"));
            updateGateLabel(targetNode);
          });

          // Update gate labels after deletion
          updateGateLabel(node);

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
    let find_path = false;
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
        find_path = true;
      }

      selectedNode = node;
      selectedNode.addClass("highlighted");

      // Create connection
      connectGates(find_path);
    }
  }

  function connectGates(find_path) {
    const sourceX = selectedSourceNode.data("x");
    const sourceY = selectedSourceNode.data("y");
    const targetX = selectedNode.data("x");
    const targetY = selectedNode.data("y");

    // Check if the source node can have more outgoing connections
    const existingOutEdges = selectedSourceNode
      .connectedEdges()
      .filter((edge) => edge.data("source") === selectedSourceNode.id());
    let maxFanouts = 1;
    const sourceGateType = selectedSourceNode.data("gateType").toLowerCase();
    const targetGateType = selectedNode.data("gateType").toLowerCase();
    if (sourceGateType === "po") {
      maxFanouts = 0;
    } else if (
      sourceGateType === "buf" ||
      sourceGateType === "bufc" ||
      sourceGateType === "bufk" ||
      sourceGateType === "fanout"
    ) {
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
        source_gate_type: sourceGateType,
        target_x: targetX,
        target_y: targetY,
        target_gate_type: targetGateType,
        find_path: find_path
      }),
      success: (data) => {
        if (data.success) {
          const path = data.path;
          for (let i = 0; i < path.length - 1; i++) {
            const sourceId = `node-${path[i][0]}-${path[i][1]}`;
            const targetId = `node-${path[i + 1][0]}-${path[i + 1][1]}`;
            cy.add({
              group: "edges",
              data: {
                id: `edge-${sourceId}-${targetId}`,
                source: sourceId,
                target: targetId,
              },
            });
            if (0 < i) {
              let sourceNode = cy.getElementById(sourceId)
              sourceNode.data("gateType", "BUF");
              sourceNode.data("label", "BUF");
              sourceNode.data("hasGate", true);
              updateGateLabel(sourceNode);
            }
          }
          if (data.updateBufToFanout) {
            selectedSourceNode.data("gateType", "Fanout");
          }

          // Update gate labels after adding the edge
          updateGateLabel(selectedNode);
          updateGateLabel(selectedSourceNode);

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

  // Connect two existing gates
  function handleMoveGate(node) {
    if (!selectedSourceNode) {
      if (!node.data("hasGate")) {
        updateMessageArea("Please select a gate to move.", "danger");
        return;
      }
      selectedSourceNode = node;
      selectedSourceNode.addClass("highlighted");
      updateMessageArea("Now select the location to move the gate to.", "info");
    } else if (!selectedNode) {
      if (node.data("hasGate")) {
        updateMessageArea("Target location has to be empty.", "danger");
        return;
      }
      selectedNode = node;
      selectedNode.addClass("highlighted");

      // Create connection
      moveGate();
    }
  }

  function moveGate() {
    const sourceX = selectedSourceNode.data("x");
    const sourceY = selectedSourceNode.data("y");
    const sourceGateType = selectedSourceNode.data("gateType").toLowerCase();
    const targetX = selectedNode.data("x");
    const targetY = selectedNode.data("y");

    // Proceed to connect
    $.ajax({
      url: "/move_gate",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        source_x: sourceX,
        source_y: sourceY,
        source_gate_type: sourceGateType,
        target_x: targetX,
        target_y: targetY,
      }),
      success: (data) => {
        if (data.success) {
          const connectedEdges = selectedSourceNode.connectedEdges();
          cy.remove(connectedEdges);

          // Reset node label and style
          selectedSourceNode.data("label", "");
          selectedSourceNode.data("gateType", "");
          selectedSourceNode.data("hasGate", false);
          updateGateLabel(selectedSourceNode);

          const inEdges = connectedEdges.filter(
            (edge) => edge.data("target") === selectedSourceNode.id(),
          );
          // Loop through each incoming edge to determine where the connection is coming from
          inEdges.forEach((edge) => {
            const sourceNode = cy.getElementById(edge.data("source"));
            if (sourceNode.data("gateType").toLowerCase() === "fanout") {
              sourceNode.data("gateType", "buf");
            }
            updateGateLabel(sourceNode);
          });

          const outEdges = connectedEdges.filter(
            (edge) => edge.data("source") === selectedSourceNode.id(),
          );
          // Loop through each outgoing edge to determine where the connection is coming from
          outEdges.forEach((edge) => {
            const targetNode = cy.getElementById(edge.data("target"));
            updateGateLabel(targetNode);
          });

          selectedNode.data("label", `${sourceGateType.toUpperCase()}`);
          selectedNode.data("gateType", `${sourceGateType.toUpperCase()}`);
          selectedNode.data("hasGate", true);

          if (data.updateGateType) {
            selectedNode.data("gateType", "buf");
            selectedNode.data("label", "");
          }
          updateGateLabel(selectedNode);

          updateMessageArea("Gate moved successfully.", "success");
        } else {
          updateMessageArea("Failed to move gate: " + data.error, "danger");
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
          displayViolations(data.errors, data.warnings, data.report);
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

  // Handle close button click for violations-area
  $("#violations-area .close-violations").on("click", function () {
    $("#violations-area").fadeOut(300, function () {
      $(this).removeClass("show").addClass("d-none");
    });
  });

  // Function to display equivalence results
  function displayEquivalence(equivalence, counter_example) {
    const equivalenceArea = $("#equivalence-area");

    // Clear any existing content except the heading
    equivalenceArea.find("h5").nextAll().remove();

    if (equivalence === "STRONG" || equivalence === "WEAK") {
      equivalenceArea
        .removeClass("alert-warning alert-danger alert-info")
        .addClass("alert-success");
      equivalenceArea.find("h5").text("Network and Layout are equivalent.");
      equivalenceArea.append(
        `<p>Equivalence Type: <strong>${equivalence}</strong></p>`,
      );
    } else {
      equivalenceArea
        .removeClass("alert-success alert-info alert-warning alert-danger")
        .addClass("alert-warning");
      equivalenceArea.find("h5").text("Network and Layout are not equivalent.");
      if (counter_example && counter_example.length !== 0) {
        equivalenceArea.append(`<p>Counter Example: ${counter_example}</p>`);
      } else {
        equivalenceArea.append(
          `<p>No counter example provided. (Network or Layout has DRVs)</p>`,
        );
      }
    }

    // Show the equivalence area with fade-in effect
    equivalenceArea.removeClass("d-none").fadeIn(100, function () {
      $(this).addClass("show");
    });
  }

  // Function to display design rule violations
  function displayViolations(errors, warnings, report) {
    const violationsArea = $("#violations-area");
    const violationsList = $("#violations-list");

    // Clear any existing content
    violationsList.empty();

    // Initialize flags to check presence
    const hasErrors = errors > 0;
    const hasWarnings = warnings > 0;

    // Determine the appropriate alert class and heading
    if (hasErrors && hasWarnings) {
      // Both Errors and Warnings
      violationsArea
        .removeClass("alert-success alert-warning")
        .addClass("alert-danger");
      violationsArea.find("h5").text("Design Rule Errors and Warnings:");

      // Append Errors with Label
      violationsList.append(`
      <li>
        <i class="fas fa-exclamation-circle text-danger me-2" aria-hidden="true"></i>
        <strong>Errors:</strong> ${errors}
      </li>
    `);

      // Append Warnings with Label
      violationsList.append(`
      <li>
        <i class="fas fa-exclamation-triangle text-warning me-2" aria-hidden="true"></i>
        <strong>Warnings:</strong> ${warnings}
      </li>
    `);
    } else if (hasErrors) {
      // Only Errors
      violationsArea
        .removeClass("alert-success alert-warning")
        .addClass("alert-danger");
      violationsArea.find("h5").text("Design Rule Errors:");

      // Append Errors with Label
      violationsList.append(`
      <li>
        <i class="fas fa-exclamation-circle text-danger me-2" aria-hidden="true"></i>
        <strong>Errors:</strong> ${errors}
      </li>
    `);
    } else if (hasWarnings) {
      // Only Warnings
      violationsArea
        .removeClass("alert-success alert-danger")
        .addClass("alert-warning");
      violationsArea.find("h5").text("Design Rule Warnings:");

      // Append Warnings with Label
      violationsList.append(`
      <li>
        <i class="fas fa-exclamation-triangle text-warning me-2" aria-hidden="true"></i>
        <strong>Warnings:</strong> ${warnings}
      </li>
    `);
    } else {
      // No Violations
      violationsArea
        .removeClass("alert-warning alert-danger")
        .addClass("alert-success");
      violationsArea.find("h5").text("No Design Rule Violations Found.");

      // Append Success Message
      violationsList.append(`
      <li>
        <i class="fas fa-check-circle text-success me-2" aria-hidden="true"></i>
        All design rules are satisfied.
      </li>
    `);
    }

    violationsList.append(`<pre>${report}</pre>`);

    // Show the Violations Area
    violationsArea.removeClass("d-none").fadeIn(100, function () {
      $(this).addClass("show");
    });
  }

  // Check Equivalence
  $("#check-equivalence-button").on("click", function () {
    $.ajax({
      url: "/check_equivalence",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({}),
      success: (data) => {
        if (data.success) {
          displayEquivalence(data.equivalence, data.counter_example);
        } else {
          updateMessageArea(
            "Failed to check equivalence: " + data.error,
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

  $("#equivalence-area .close-equivalence").on("click", function () {
    $("#equivalence-area").fadeOut(100, function () {
      $(this).removeClass("show").addClass("d-none");
    });
  });

  // Export Layout
  $("#export-fgl-layout-button").on("click", function () {
    // Show a loading spinner or disable the button during the download
    $("#export-fgl-layout-button").prop("disabled", true);

    // Trigger the download
    window.location.href = "/export_layout";

    // Re-enable the button after a delay (or based on another event like download completion)
    setTimeout(function () {
      $("#export-fgl-layout-button").prop("disabled", false);
    }, 3000); // Adjust this delay based on the expected download time
  });

  // Export DOT Layout
  $("#export-dot-layout-button").on("click", function () {
    // Show a loading spinner or disable the button during the download
    $("#export-dot-layout-button").prop("disabled", true);

    // Trigger the download
    window.location.href = "/export_dot_layout";

    // Re-enable the button after a delay (or based on another event like download completion)
    setTimeout(function () {
      $("#export-dot-layout-button").prop("disabled", false);
    }, 3000); // Adjust this delay based on the expected download time
  });

  // Export QCA Layout
  $("#export-qca-layout-button").on("click", function () {
    // Show a loading spinner or disable the button during the download
    $("#export-qca-layout-button").prop("disabled", true);

    // Trigger the download
    window.location.href = "/export_qca_layout";

    // Re-enable the button after a delay (or based on another event like download completion)
    setTimeout(function () {
      $("#export-qca-layout-button").prop("disabled", false);
    }, 3000); // Adjust this delay based on the expected download time
  });

  // Export SiDB Layout
  $("#export-sidb-layout-button").on("click", function () {
    // Show a loading spinner or disable the button during the download
    $("#export-sidb-layout-button").prop("disabled", true);

    // Trigger the download
    window.location.href = "/export_sidb_layout";

    // Re-enable the button after a delay (or based on another event like download completion)
    setTimeout(function () {
      $("#export-sidb-layout-button").prop("disabled", false);
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

          // **Update the form input fields with the current layout dimensions**
          $("#x-dimension").val(data.layoutDimensions.x);
          $("#y-dimension").val(data.layoutDimensions.y);

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

  function loadEditor() {
    $.ajax({
      url: "/get_verilog_code", // Endpoint to fetch Verilog code
      type: "GET",
      dataType: "json",
      success: function (data) {
        if (data.success) {
          // Load the Verilog code into the Ace Editor
          editor.setValue(data.code, -1); // The second parameter moves the cursor to the start
          updateMessageArea("Verilog code loaded successfully.", "success");
          valid_verilog = true;
        } else {
          updateMessageArea(
            "No existing Verilog code found. Please write new Verilog code.",
            "info",
          );
          valid_verilog = false;
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        // AJAX request failed
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
    node.data("gateType", `${gateType.toUpperCase()}`);
    node.data("hasGate", true);

    updateGateLabel(node);
  }
});
