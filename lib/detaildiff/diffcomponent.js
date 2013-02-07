var DiffComponent = {
	create: function(container) {
		var _this = this;
		_this.baseContent = null;
		_this.newContent = null;
		_this.spinner = null;

		this.load = function(url1, url2) {
			_this.spinner = new Spinner({}).spin(((container instanceof jQuery) ? container[0] : container));

			$.get(url1, function(data1) {
				console.log("Successfully got file 1!");
				_this.baseContent = $.parseJSON(data1);
				_this.doDiff();
			});

			$.get(url2, function(data2) {
				console.log("Successfully got file 2!");
				_this.newContent = $.parseJSON(data2);
				_this.doDiff();
			});
		};

		this.doDiff = function() {
			if(_this.baseContent === null || _this.newContent === null)
				return;

			var baseLines = DiffLib.stringAsLines(_this.baseContent.source);
			var newLines = DiffLib.stringAsLines(_this.newContent.source);

			// create a SequenceMatcher instance that diffs the two sets of lines
			var sm = new DiffLib.SequenceMatcher(baseLines, newLines);

			// get the opcodes from the SequenceMatcher instance
			// opcodes is a list of 3-tuples describing what changes should be made to the base text
			// in order to yield the new text
			var opcodes = sm.get_opcodes();

			// build the diff view and add it to the current DOM
			var view = DiffView.create({
				baseLines: baseLines,
				newLines: newLines,
				opcodes: opcodes,
				baseTitle: this.baseContent.name,
				newTitle: this.newContent.name,
				tab: "<span class=\"diff_tab\">    </span>",
				space: "<span class=\"diff_space\"> </span>"
			}).hide();
			$(container).html(view);
			if(_this.spinner) _this.spinner.stop();
			view.fadeIn();
		};
	}
}