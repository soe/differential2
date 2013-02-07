DiffView = {
	create: function (params) {
		var baseLines = params.baseLines;
		var newLines = params.newLines;
		var opcodes = params.opcodes;
		var baseTitle = params.baseTitle ? params.baseTitle : "Base Text";
		var newTitle = params.newTitle ? params.newTitle : "New Text";
		var tab = params.tab ? params.tab : "\u00a0\u00a0\u00a0\u00a0";
		var space = params.space ? params.space : " ";

		if (baseLines == null)
			throw "Cannot build diff view; baseLines is not defined.";
		if (newLines == null)
			throw "Cannot build diff view; newLines is not defined.";
		if (!opcodes)
			throw "Cannot build diff view; opcodes is not defined.";

		var rows = [];
		var node2;

		function escape_html(str) {
			return $("<div />").text(str).html();
		}
		
		/**
		 * Adds two cells to the given row; if the given row corresponds to a real
		 * line number (based on the line index tidx and the endpoint of the 
		 * range in question tend), then the cells will contain the line number
		 * and the line of text from textLines at position tidx (with the class of
		 * the second cell set to the name of the change represented), and tidx + 1 will
		 * be returned.	 Otherwise, tidx is returned, and two empty cells are added
		 * to the given row.
		 */
		function addCells (row, tidx, tend, textLines, change) {
			if (tidx < tend) {
				row.append($("<th />").addClass("diff_line_number").text((tidx + 1).toString()));

				var td = $("<td />").addClass(change);

				var escaped_line = escape_html(textLines[tidx]);
				escaped_line = escaped_line.replace(/ /g, space);
				escaped_line = escaped_line.replace(/\t/g, tab);
				td.html(escaped_line);

				row.append(td);

				return tidx + 1;
			} else {
				row.append($("<th />"));
				row.append($("<td />").addClass("empty"));
				return tidx;
			}
		}
		
		for (var idx = 0; idx < opcodes.length; idx++) {
			code = opcodes[idx];
			change = code[0];
			var b = code[1];
			var be = code[2];
			var n = code[3];
			var ne = code[4];
			var rowcnt = Math.max(be - b, ne - n);
			var toprows = [];
			var botrows = [];
			for (var i = 0; i < rowcnt; i++) {
				var node = $("<tr />")
				toprows.push(node);
				b = addCells(node, b, be, baseLines, change);
				n = addCells(node, n, ne, newLines, change);
			}

			for (var i = 0; i < toprows.length; i++)
				rows.push(toprows[i]);
			for (var i = 0; i < botrows.length; i++)
				rows.push(botrows[i]);
		}

		var table = $("<table />").addClass("diff_lines");
		for (var idx in rows)
			table.append(rows[idx]);

		var container = $("<div />").addClass("diff_container");
		var inner = $("<div />").addClass("diff_inner");
		var mainview = $("<div />").addClass("diff_mainview");
		var overview = $("<div />").addClass("diff_overview");

		mainview.append(table);
		inner.append(mainview);
		inner.append(overview);

		// Create the titles
		var titles = $("<div />").addClass("diff_titlebar");
		titles.append($("<div />").addClass("left").text(baseTitle));
		titles.append($("<div />").addClass("right").text(newTitle));
		
		//container.append(titles);
		container.append(inner);

		// Build overview
		var numLines = Math.max(baseLines.length, newLines.length);

		for (var i = 0; i < opcodes.length; i++) {
			var opcode = opcodes[i];

			// Don't include empty blocks
			if(opcode[0] === "equal")
				continue;

			// Create a div for the line
			var line = $("<div />").addClass("diff_overview_line");

			// Assign the line a class based on the type of diff change
			line.addClass(opcode[0]);
			
			// Get the percentage from the top
			var top = Math.max(opcode[1], opcode[3]) / numLines * 100;

			// Get the height as a percentage of the height
			var height = Math.max(opcode[2] - opcode[1], opcode[4] - opcode[3]) / numLines * 100;

			if(top + height < 100) {
				// There is no overlap
				line.css({
					top: top + "%",
					height: height + "%"
				});
			} else {
				// There is an overlap at the bottom
				line.css({
					bottom: 0,
					height: height + "%"
				});
			}

			// Add the current line to the overview panel
			overview.append(line);
		};

		// Set up handlers for clicking in the overview pane

		// Whether or not the mouse is currently pressed
		var leftButtonDown = false;

		function doScroll(e) {
			// Check from jQuery UI for IE versions < 9
			if ($.browser.msie && !(document.documentMode >= 9) && !event.button) {
				leftButtonDown = false;
			}
			
			// If left button is not set, set which to 0
			// This indicates no buttons pressed
			if(e.which === 1 && !leftButtonDown) e.which = 0;

			if(leftButtonDown) {
				// Get the height of the viewing "window"
				var inner_h = inner.height();

				// Get the height of all of the contents
				var total_h = table.height();

				// Get the y position of the mouse movement, relative to the overview
				var y = e.pageY - overview.offset().top;

				// Find the position to scroll to accounting for the height of the 
				var pos = (y - inner_h * inner_h / (2 * total_h)) / inner_h * total_h;
				pos = Math.min(total_h, Math.max(0, pos));

				// Set position
				mainview.animate({scrollTop: pos}, 0);
			}
		}

		overview.mousedown(function(e) {
			// Left mouse button was pressed, set flag
			if(e.which === 1) leftButtonDown = true;
			doScroll(e);
		});
		overview.mouseup(function(e) {
			// Left mouse button was released, clear flag
			if(e.which === 1) leftButtonDown = false;
			doScroll(e);
		});
		overview.mousemove(function(e) {
			doScroll(e);
		});

		return container;
	}
}