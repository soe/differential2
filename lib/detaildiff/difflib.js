/*
This is a full re-write of Python's difflib.
The jsdifflib also contains an implementation but only licensed
under BSD. This version is unlicensed  and includes much more 
documentation. The documentation is borrowed from the actual 
Python source code and therefore may contain some Python syntax.
*/

var DiffLib = {
	stringAsLines: function(str) {
		var stripLineBreaks = function(s) {
			return s.replace(/^[\n\r]*|[\n\r]*$/g, "");
		};

		var lfpos = str.indexOf("\n");
		var crpos = str.indexOf("\r");
		var linebreak = ((lfpos > -1 && crpos > -1) || crpos < 0) ? "\n" : "\r";
		
		var lines = str.split(linebreak);
		for (var i = 0; i < lines.length; i++) {
			lines[i] = stripLineBreaks(lines[i]);
		}
		
		return lines;
	},
	SequenceMatcher: function(a, b, isjunk) {
		/*
		Members:
			a
				first sequence
			b
				second sequence; differences are computed as "what do
				we need to do to 'a' to change it into 'b'?"
			b2j
				for x in b, b2j[x] is a list of the indices (into b)
				at which x appears; junk elements do not appear
			fullbcount
				appears in b; only materialized if really needed (used
				for x in b, fullbcount[x] == the number of times x
				only for computing quick_ratio())
			matching_blocks
				a list of (i, j, k) triples, where a[i:i+k] == b[j:j+k];
				ascending & non-overlapping in i and in j; terminated by
				a dummy (len(a), len(b), 0) sentinel
			opcodes
				a list of (tag, i1, i2, j1, j2) tuples, where tag is
				one of
					'replace'   a[i1:i2] should be replaced by b[j1:j2]
					'delete'    a[i1:i2] should be deleted
					'insert'    b[j1:j2] should be inserted
					'equal'     a[i1:i2] == b[j1:j2]
			isjunk
				a user-supplied function taking a sequence element and
				returning true iff the element is "junk" -- this has
				subtle but helpful effects on the algorithm, which I'll
				get around to writing up someday <0.9 wink>.
				DON'T USE!  Only __chain_b uses this.  Use isbjunk.
			isbjunk
				for x in b, isbjunk(x) == isjunk(x) but much faster;
				it's really the __contains__ method of a hidden dict.
				DOES NOT WORK for x in a!
			isbpopular
				for x in b, isbpopular(x) is true iff b is reasonably long
				(at least 200 elements) and x accounts for more than 1% of
				its elements.  DOES NOT WORK for x in a!
		*/

		/*
		Set the two sequences to be compared.

			>>> s = SequenceMatcher()
			>>> s.set_seqs("abcd", "bcde")
			>>> s.ratio()
			0.75
		*/
		this.set_seqs = function(a, b) {
			this.set_seq1(a);
			this.set_seq2(b);
		};

		/*
		Set the first sequence to be compared.
		
		The second sequence to be compared is not changed.
		
			>>> s = SequenceMatcher(None, "abcd", "bcde")
			>>> s.ratio()
			0.75
			>>> s.set_seq1("bcde")
			>>> s.ratio()
			1.0
			>>>
		
		SequenceMatcher computes and caches detailed information about the
		second sequence, so if you want to compare one sequence S against
		many sequences, use .set_seq2(S) once and call .set_seq1(x)
		repeatedly for each of the other sequences.
		
		See also set_seqs() and set_seq2().
		*/
		this.set_seq1 = function(a) {
			if(a === this.a)
				return;

			this.a = a;
			this.matching_blocks = null;
			this.opcodes = null;
		};

		/*
		Set the second sequence to be compared.
		
		The first sequence to be compared is not changed.
		
			>>> s = SequenceMatcher(None, "abcd", "bcde")
			>>> s.ratio()
			0.75
			>>> s.set_seq2("abcd")
			>>> s.ratio()
			1.0
			>>>
		
		SequenceMatcher computes and caches detailed information about the
		second sequence, so if you want to compare one sequence S against
		many sequences, use .set_seq2(S) once and call .set_seq1(x)
		repeatedly for each of the other sequences.
		
		See also set_seqs() and set_seq1().
		*/
		this.set_seq2 = function(b) {
			if(b === this.b)
				return;

			this.b = b;
			this.matching_blocks = null;
			this.opcodes = null;
			this.fullbcount = null;
			this.__chain_b();
		};

		// For each element x in b, set b2j[x] to a list of the indices in
		// b where x appears; the indices are in increasing order; note that
		// the number of times x appears in b is len(b2j[x]) ...
		// when self.isjunk is defined, junk elements don't show up in this
		// map at all, which stops the central find_longest_match method
		// from starting any matching block at a junk element ...
		// also creates the fast isbjunk function ...
		// b2j also does not contain entries for "popular" elements, meaning
		// elements that account for more than 1% of the total elements, and
		// when the sequence is reasonably large (>= 200 elements); this can
		// be viewed as an adaptive notion of semi-junk, and yields an enormous
		// speedup when, e.g., comparing program files with hundreds of
		// instances of "return NULL;" ...
		// note that this is only called when b changes; so for cross-product
		// kinds of matches, it's best to call set_seq2 once, then set_seq1
		// repeatedly


		this.__chain_b = function() {
			// Because isjunk is a user-defined (not C) function, and we test
			// for junk a LOT, it's important to minimize the number of calls.
			// Before the tricks described here, __chain_b was by far the most
			// time-consuming routine in the whole module!  If anyone sees
			// Jim Roskind, thank him again for profile.py -- I never would
			// have guessed that.
			// The first trick is to build b2j ignoring the possibility
			// of junk.  I.e., we don't call isjunk at all yet.  Throwing
			// out the junk later is much cheaper than building b2j "right"
			// from the start.

			var b = this.b;
			var n = b.length;
			var b2j = this.b2j = {};
			var populardict = {};
			for (var i = 0; i < b.length; i++) {
				var elt = b[i];

				if (b2j.hasOwnProperty(elt)) {
					var indices = b2j[elt];

					if (n >= 200 && indices.length * 100 > n) {
						populardict[elt] = 1;
						delete b2j[elt];
					} else {
						indices.push(i);
					}
				} else {
					b2j[elt] = [i];
				}
			}

			// Purge leftover indices for popular elements.
			for (var elt in populardict) {
				if (populardict.hasOwnProperty(elt)) {
					delete b2j[elt];
				}
			}
			
			// Now b2j.keys() contains elements uniquely, and especially when
			// the sequence is a string, that's usually a good deal smaller
			// than len(string).  The difference is the number of isjunk calls
			// saved.
			var isjunk = this.isjunk;
			var junkdict = {};
			if (isjunk) {
				for (var elt in populardict) {
					if (populardict.hasOwnProperty(elt) && isjunk(elt)) {
						junkdict[elt] = 1;
						delete populardict[elt];
					}
				}
				for (var elt in b2j) {
					if (b2j.hasOwnProperty(elt) && isjunk(elt)) {
						junkdict[elt] = 1;
						delete b2j[elt];
					}
				}
			}

			// Now for x in b, isjunk(x) == x in junkdict, but the
			// latter is much faster.  Note too that while there may be a
			// lot of junk in the sequence, the number of *unique* junk
			// elements is probably small.  So the memory burden of keeping
			// this dict alive is likely trivial compared to the size of b2j.
			this.isbjunk = function(c) {
				return junkdict.hasOwnProperty(c);
			};
			this.isbpopular = function(c) {
				return populardict.hasOwnProperty(c);
			};
		};

		/*
		Find longest matching block in a[alo:ahi] and b[blo:bhi].
		
		If isjunk is not defined:
		
		Return (i,j,k) such that a[i:i+k] is equal to b[j:j+k], where
			alo <= i <= i+k <= ahi
			blo <= j <= j+k <= bhi
		and for all (i',j',k') meeting those conditions,
			k >= k'
			i <= i'
			and if i == i', j <= j'
		
		In other words, of all maximal matching blocks, return one that
		starts earliest in a, and of all those maximal matching blocks that
		start earliest in a, return the one that starts earliest in b.
		
			>>> s = SequenceMatcher(None, " abcd", "abcd abcd")
			>>> s.find_longest_match(0, 5, 0, 9)
			Match(a=0, b=4, size=5)
		
		If isjunk is defined, first the longest matching block is
		determined as above, but with the additional restriction that no
		junk element appears in the block.  Then that block is extended as
		far as possible by matching (only) junk elements on both sides.  So
		the resulting block never matches on junk except as identical junk
		happens to be adjacent to an "interesting" match.
		
		Here's the same example as before, but considering blanks to be
		junk.  That prevents " abcd" from matching the " abcd" at the tail
		end of the second sequence directly.  Instead only the "abcd" can
		match, and matches the leftmost "abcd" in the second sequence:
		
			>>> s = SequenceMatcher(lambda x: x==" ", " abcd", "abcd abcd")
			>>> s.find_longest_match(0, 5, 0, 9)
			Match(a=1, b=0, size=4)
		
		If no blocks match, return (alo, blo, 0).
		
			>>> s = SequenceMatcher(None, "ab", "c")
			>>> s.find_longest_match(0, 2, 0, 1)
			Match(a=0, b=0, size=0)
		*/
		this.find_longest_match = function(alo, ahi, blo, bhi) {
			// CAUTION:  stripping common prefix or suffix would be incorrect.
			// E.g.,
			//    ab
			//    acab
			// Longest matching block is "ab", but if common prefix is
			// stripped, it's "a" (tied with "b").  UNIX(tm) diff does so
			// strip, so ends up claiming that ab is changed to acab by
			// inserting "ca" in the middle.  That's minimal but unintuitive:
			// "it's obvious" that someone inserted "ac" at the front.
			// Windiff ends up at the same place as diff, but by pairing up
			// the unique 'b's and then matching the first two 'a's.

			var a = this.a;
			var b = this.b;
			var b2j = this.b2j;
			var isbjunk = this.isbjunk;
			var besti = alo;
			var bestj = blo;
			var bestsize = 0;

			// find longest junk-free match
			// during an iteration of the loop, j2len[j] = length of longest
			// junk-free match ending with a[i-1] and b[j]
			var j2len = {};
			var nothing = [];
			for (var i = alo; i < ahi; i++) {
				var newj2len = {};
				//var jdict = python_helpers.obj_get(b2j, a[i], nothing);
				var jdict = b2j.hasOwnProperty(a[i]) ? b2j[a[i]] : nothing;
				for (var jkey in jdict) {
					if (jdict.hasOwnProperty(jkey)) {
						j = jdict[jkey];
						if (j < blo)
							continue;
						if (j >= bhi)
							break;
						//newj2len[j] = k = python_helpers.obj_get(j2len, j - 1, 0) + 1;
						newj2len[j] = k = (j2len.hasOwnProperty(j - 1) ? j2len[j - 1] : 0) + 1;
						if (k > bestsize) {
							besti = i - k + 1;
							bestj = j - k + 1;
							bestsize = k;
						}
					}
				}
				j2len = newj2len;
			}

			// Extend the best by non-junk elements on each end.  In particular,
			// "popular" non-junk elements aren't in b2j, which greatly speeds
			// the inner loop above, but also means "the best" match so far
			// doesn't contain any junk *or* popular non-junk elements.
			while (besti > alo &&
				   bestj > blo &&
				   !isbjunk(b[bestj - 1]) && 
				   a[besti - 1] === b[bestj - 1]) {
				besti--;
				bestj--;
				bestsize++;
			}
			while (besti + bestsize < ahi &&
				   bestj + bestsize < bhi &&
				   !isbjunk(b[bestj + bestsize]) &&
				   a[besti + bestsize] === b[bestj + bestsize]) {
				bestsize++;
			}

			// Now that we have a wholly interesting match (albeit possibly
			// empty!), we may as well suck up the matching junk on each
			// side of it too.  Can't think of a good reason not to, and it
			// saves post-processing the (possibly considerable) expense of
			// figuring out what to do with it.  In the case of an empty
			// interesting match, this is clearly the right thing to do,
			// because no other kind of match is possible in the regions.
			while (besti > alo &&
				   bestj > blo && 
				   isbjunk(b[bestj - 1]) && 
				   a[besti - 1] === b[bestj - 1]) {
				besti--;
				bestj--;
				bestsize++;
			}
			while (besti + bestsize < ahi && 
				   bestj + bestsize < bhi && 
				   isbjunk(b[bestj + bestsize]) &&
				   a[besti + bestsize] === b[bestj + bestsize]) {
				bestsize++;
			}

			return [besti, bestj, bestsize];
		};

		/*
		Return list of triples describing matching subsequences.
		
		Each triple is of the form (i, j, n), and means that
		a[i:i+n] == b[j:j+n].  The triples are monotonically increasing in
		i and in j.  New in Python 2.5, it's also guaranteed that if
		(i, j, n) and (i', j', n') are adjacent triples in the list, and
		the second is not the last triple in the list, then i+n != i' or
		j+n != j'.  IOW, adjacent triples never describe adjacent equal
		blocks.
		
		The last triple is a dummy, (len(a), len(b), 0), and is the only
		triple with n==0.
		
			>>> s = SequenceMatcher(None, "abxcd", "abcd")
			>>> s.get_matching_blocks()
			[Match(a=0, b=0, size=2), Match(a=3, b=2, size=2), Match(a=5, b=4, size=0)]
		*/
		this.get_matching_blocks = function() {
			if (this.matching_blocks !== null)
				return this.matching_blocks;
			var la = this.a.length;
			var lb = this.b.length;

			// This is most naturally expressed as a recursive algorithm, but
			// at least one user bumped into extreme use cases that exceeded
			// the recursion limit on their box.  So, now we maintain a list
			// ('queue`) of blocks we still need to look at, and append partial
			// results to `matching_blocks` in a loop; the matches are sorted
			// at the end.
			var queue = [[0, la, 0, lb]];
			var matching_blocks = [];
			var alo, ahi, blo, bhi, queue_pop, i, j, k, x;
			while (queue.length) {
				queue_pop = queue.pop();
				alo = queue_pop[0];
				ahi = queue_pop[1];
				blo = queue_pop[2];
				bhi = queue_pop[3];

				x = this.find_longest_match(alo, ahi, blo, bhi);
				// a[alo:i] vs b[blo:j] unknown
				// a[i:i+k] same as b[j:j+k]
				// a[i+k:ahi] vs b[j+k:bhi] unknown
				i = x[0];
				j = x[1];
				k = x[2];

				// if k is 0, there was no matching block
				if (k) {
					matching_blocks.push(x);
					if (alo < i && blo < j)
						queue.push([alo, i, blo, j]);
					if (i + k < ahi && j + k < bhi)
						queue.push([i + k, ahi, j + k, bhi]);
				}
			}
			matching_blocks.sort(function(a, b) {
				var mlen = Math.max(a.length, b.length);
				for (var i = 0; i < mlen; i++) {
					if (a[i] < b[i])
						return -1;
					if (a[i] > b[i])
						return 1;
				}
				
				return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
			});

			// It's possible that we have adjacent equal blocks in the
			// matching_blocks list now.  Starting with 2.5, this code was added
			// to collapse them.
			var i1 = 0;
			var j1 = 0;
			var k1 = 0;
			var block = 0;
			var non_adjacent = [];
			for (var idx in matching_blocks) {
				if (matching_blocks.hasOwnProperty(idx)) {
					block = matching_blocks[idx];
					var i2 = block[0];
					var j2 = block[1];
					var k2 = block[2];

					// Is this block adjacent to i1, j1, k1?
					if (i1 + k1 === i2 && j1 + k1 === j2) {
						// Yes, so collapse them -- this just increases the length of
						// the first block by the length of the second, and the first
						// block so lengthened remains the block to compare against.
						k1 += k2;
					}
					else {
						// Not adjacent.  Remember the first block (k1==0 means it's
						// the dummy we started with), and make the second block the
						// new block to compare against.
						if (k1)
							non_adjacent.push([i1, j1, k1]);
						i1 = i2;
						j1 = j2;
						k1 = k2;
					}
				}
			}
			if (k1)
				non_adjacent.push([i1, j1, k1]);

			non_adjacent.push([la, lb, 0]);
			this.matching_blocks = non_adjacent;
			return this.matching_blocks;
		};

		/*
		Return list of 5-tuples describing how to turn a into b.
		
		Each tuple is of the form (tag, i1, i2, j1, j2).  The first tuple
		has i1 == j1 == 0, and remaining tuples have i1 == the i2 from the
		tuple preceding it, and likewise for j1 == the previous j2.
		
		The tags are strings, with these meanings:
		
		'replace':  a[i1:i2] should be replaced by b[j1:j2]
		'delete':   a[i1:i2] should be deleted.
		            Note that j1==j2 in this case.
		'insert':   b[j1:j2] should be inserted at a[i1:i1].
		            Note that i1==i2 in this case.
		'equal':    a[i1:i2] == b[j1:j2]
		
			>>> a = "qabxcd"
			>>> b = "abycdf"
			>>> s = SequenceMatcher(None, a, b)
			>>> for tag, i1, i2, j1, j2 in s.get_opcodes():
			...    print ("%7s a[%d:%d] (%s) b[%d:%d] (%s)" %
			...           (tag, i1, i2, a[i1:i2], j1, j2, b[j1:j2]))
			 delete a[0:1] (q) b[0:0] ()
			  equal a[1:3] (ab) b[0:2] (ab)
			replace a[3:4] (x) b[2:3] (y)
			  equal a[4:6] (cd) b[3:5] (cd)
			 insert a[6:6] () b[5:6] (f)
		*/
		this.get_opcodes = function() {
			if (this.opcodes !== null)
				return this.opcodes;
			var i = 0;
			var j = 0;
			var answer = [];
			this.opcodes = answer;

			var block, ai, bj, size, tag;
			var blocks = this.get_matching_blocks();
			for (var idx in blocks) {
				if (blocks.hasOwnProperty(idx)) {
					block = blocks[idx];
					ai = block[0];
					bj = block[1];
					size = block[2];

					// invariant:  we've pumped out correct diffs to change
					// a[:i] into b[:j], and the next matching block is
					// a[ai:ai+size] == b[bj:bj+size].  So we need to pump
					// out a diff to change a[i:ai] into b[j:bj], pump out
					// the matching block, and move (i,j) beyond the match
					tag = "";
					if (i < ai && j < bj) {
						tag = 'replace';
					} else if (i < ai) {
						tag = 'delete';
					} else if (j < bj) {
						tag = 'insert';
					}
					if (tag)
						answer.push([tag, i, ai, j, bj]);
					i = ai + size;
					j = bj + size;
					
					// the list of matching blocks is terminated by a
					// sentinel with size 0
					if (size)
						answer.push(['equal', ai, i, bj, j]);
				}
			}
			return answer;
		};

		/*
		Isolate change clusters by eliminating ranges with no changes.
		
		Return a generator of groups with upto n lines of context.
		Each group is in the same format as returned by get_opcodes().
		
			>>> from pprint import pprint
			>>> a = map(str, range(1,40))
			>>> b = a[:]
			>>> b[8:8] = ['i']     # Make an insertion
			>>> b[20] += 'x'       # Make a replacement
			>>> b[23:28] = []      # Make a deletion
			>>> b[30] += 'y'       # Make another replacement
			>>> pprint(list(SequenceMatcher(None,a,b).get_grouped_opcodes()))
			[[('equal', 5, 8, 5, 8), ('insert', 8, 8, 8, 9), ('equal', 8, 11, 9, 12)],
			 [('equal', 16, 19, 17, 20),
			  ('replace', 19, 20, 20, 21),
			  ('equal', 20, 22, 21, 23),
			  ('delete', 22, 27, 23, 23),
			  ('equal', 27, 30, 23, 26)],
			 [('equal', 31, 34, 27, 30),
			  ('replace', 34, 35, 30, 31),
			  ('equal', 35, 38, 31, 34)]]
		*/
		this.get_grouped_opcodes = function(n) {
			// Default value of n is 3
			if(!n)
				n = 3;

			var codes = this.get_opcodes();
			if (!codes)
				codes = [["equal", 0, 1, 0, 1]];

			// Fixup leading and trailing groups if they show no changes.
			var code, tag, i1, i2, j1, j2;
			if (codes[0][0] === 'equal') {
				code = codes[0];
				tag = code[0];
				i1 = code[1];
				i2 = code[2];
				j1 = code[3];
				j2 = code[4];
				codes[0] = [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
			}
			if (codes[codes.length - 1][0] === 'equal') {
				code = codes[codes.length - 1];
				tag = code[0];
				i1 = code[1];
				i2 = code[2];
				j1 = code[3];
				j2 = code[4];
				codes[codes.length - 1] = [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
			}

			var nn = n + n;
			var group = [];
			for (var idx in codes) {
				if (codes.hasOwnProperty(idx)) {
					code = codes[idx];
					tag = code[0];
					i1 = code[1];
					i2 = code[2];
					j1 = code[3];
					j2 = code[4];

					// End the current group and start a new one whenever
					// there is a large range with no changes.
					if (tag === 'equal' && i2 - i1 > nn) {
						group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
						i1 = Math.max(i1, i2 - n);
						j1 = Math.max(j1, j2 - n);
					}
					group.push([tag, i1, i2, j1, j2]);
				}
			}

			if (group && group[group.length - 1][0] === 'equal')
				group.pop();
				
			return group;
		}

		function calculate_ratio(matches, length) {
			if(length) 
				return 2.0 * matches / length;
			else
				return 1.0;
		}

		/*
		Return a measure of the sequences' similarity (float in [0,1]).
		
		Where T is the total number of elements in both sequences, and
		M is the number of matches, this is 2.0*M / T.
		Note that this is 1 if the sequences are identical, and 0 if
		they have nothing in common.
		
		.ratio() is expensive to compute if you haven't already computed
		.get_matching_blocks() or .get_opcodes(), in which case you may
		want to try .quick_ratio() or .real_quick_ratio() first to get an
		upper bound.
		
			>>> s = SequenceMatcher(None, "abcd", "bcde")
			>>> s.ratio()
			0.75
			>>> s.quick_ratio()
			0.75
			>>> s.real_quick_ratio()
			1.0
		*/
		this.ratio = function() {
			var sum = 0;
			var blocks = this.get_matching_blocks();
			for (var i = 0; i < blocks.length; i++) {
				var block = blocks[i];
				sum += block[block.length - 1];
			};
			
			return calculate_ratio(sum, this.a.length + this.b.length);
		};

		/*
		Return an upper bound on ratio() relatively quickly.
		
		This isn't defined beyond that it is an upper bound on .ratio(), and
		is faster to compute.
		*/
		this.quick_ratio = function() {
			// viewing a and b as multisets, set matches to the cardinality
			// of their intersection; this counts the number of matches
			// without regard to order, so is clearly an upper bound
			var fullbcount;
			var elt;
			if (this.fullbcount === null) {
				this.fullbcount = {};
				fullbcount = {};
				for (var i = 0; i < this.b.length; i++) {
					elt = this.b[i];
					//fullbcount[elt] = python_helpers.obj_get(fullbcount, elt, 0) + 1;
					fullbcount[elt] = (fullbcount.hasOwnProperty(elt) ? fullbcount[elt] : 0) + 1;
				}
			}
			fullbcount = this.fullbcount;

			// avail[x] is the number of times x appears in 'b' less the
			// number of times we've seen it in 'a' so far ... kinda
			var avail = {};
			var matches = 0;
			for (var i = 0; i < this.a.length; i++) {
				elt = this.a[i];
				var numb;
				if (avail.hasOwnProperty(elt))
					numb = avail[elt];
				else
					//numb = difflib.obj_get(fullbcount, elt, 0);
					numb = fullbcount.hasOwnProperty(elt) ? fullbcount[elt] : 0;
				avail[elt] = numb - 1;
				if (numb > 0)
					matches++;
			}
			
			return calculate_ratio(matches, this.a.length + this.b.length);
		};

		/*
		Return an upper bound on ratio() very quickly.

		This isn't defined beyond that it is an upper bound on .ratio(), and
		is faster to compute than either .ratio() or .quick_ratio().
		*/
		this.real_quick_ratio = function() {
			var la = this.a.length;
			var lb = this.b.length;

			// can't have more matches than the number of elements in the
			// shorter sequence
			return calculate_ratio(Math.min(la, lb), la + lb);
		};

		// INIT
		if(isjunk)
			this.isjunk = isjunk;
		else
			this.isjunk = function(c) {
				return {" ": true, "\t": true, "\n": true, "\f": true, "\r": true}.hasOwnProperty(c);
			};

		this.a = null;
		this.b = null;
		this.set_seqs(a, b);
	}
};