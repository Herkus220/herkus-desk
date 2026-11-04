/* Hand-drawn canvas line chart. Flat line, dotted baseline, scrub with finger/mouse. No libs, no glow. */
(function (g) {
  'use strict';
  function LineChart(canvas, opts) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.o = Object.assign({ up: '#00d35a', down: '#ff453a', base: '#3a3a3f', pad: 12, onScrub: null }, opts || {});
    this.pts = []; this.scrub = null;
    var self = this;
    this._ro = new (g.ResizeObserver || function () { return { observe: function () {} }; })(function () { self.draw(); });
    this._ro.observe(canvas);
    var move = function (e) {
      var r = canvas.getBoundingClientRect();
      var x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left);
      self.scrubAt(x, r.width);
    };
    var end = function () { self.scrub = null; self.draw(); if (self.o.onScrub) self.o.onScrub(null); };
    canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); move(e); });
    canvas.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'touch' || self.scrub !== null) move(e); });
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
  }
  LineChart.prototype.set = function (points) { this.pts = (points || []).filter(function (p) { return isFinite(p[1]); }); this.draw(); };
  LineChart.prototype.scrubAt = function (x, w) {
    var n = this.pts.length; if (n < 2) return;
    var pad = this.o.pad, i = Math.round((x - pad) / (w - 2 * pad) * (n - 1));
    this.scrub = Math.max(0, Math.min(n - 1, i)); this.draw();
    if (this.o.onScrub) this.o.onScrub(this.pts[this.scrub]);
  };
  LineChart.prototype.draw = function () {
    var c = this.c, ctx = this.ctx, dpr = g.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    var p = this.pts, n = p.length, pad = this.o.pad;
    if (n < 2) {
      ctx.strokeStyle = this.o.base; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, h / 2); ctx.lineTo(w - pad, h / 2); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) { lo = Math.min(lo, p[i][1]); hi = Math.max(hi, p[i][1]); }
    if (hi - lo < 1e-12) { hi += Math.abs(hi) * 0.01 || 1; lo -= Math.abs(lo) * 0.01 || 1; }
    var top = 16, bot = h - 16;
    var X = function (k) { return pad + k / (n - 1) * (w - 2 * pad); };
    var Y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
    var first = p[0][1], last = (this.scrub !== null ? p[this.scrub] : p[n - 1])[1];
    var col = last >= first ? this.o.up : this.o.down;
    // baseline (start value)
    ctx.strokeStyle = this.o.base; ctx.lineWidth = 1; ctx.setLineDash([1.5, 4]);
    ctx.beginPath(); ctx.moveTo(pad, Y(first)); ctx.lineTo(w - pad, Y(first)); ctx.stroke(); ctx.setLineDash([]);
    // line
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 2;
    var cut = this.scrub !== null ? this.scrub : n - 1;
    ctx.strokeStyle = col; ctx.beginPath();
    for (i = 0; i <= cut; i++) { i ? ctx.lineTo(X(i), Y(p[i][1])) : ctx.moveTo(X(i), Y(p[i][1])); }
    ctx.stroke();
    if (cut < n - 1) {           // dimmed remainder while scrubbing
      ctx.strokeStyle = '#3a3a3f'; ctx.beginPath(); ctx.moveTo(X(cut), Y(p[cut][1]));
      for (i = cut + 1; i < n; i++) ctx.lineTo(X(i), Y(p[i][1]));
      ctx.stroke();
    }
    if (this.scrub !== null) {
      var sx = X(cut), sy = Y(p[cut][1]);
      ctx.strokeStyle = '#5c5c61'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, 4); ctx.lineTo(sx, h - 4); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8e8e93'; ctx.font = '600 11px -apple-system, sans-serif'; ctx.textAlign = sx > w - 60 ? 'right' : sx < 60 ? 'left' : 'center';
      ctx.fillText(new Date(p[cut][0] * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), sx, 11);
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(n - 1), Y(p[n - 1][1]), 3.5, 0, Math.PI * 2); ctx.fill();
    }
  };
  g.LineChart = LineChart;
})(window);
