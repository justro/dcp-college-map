/*!
 * DePaul College Prep — College Matriculation Map
 * An embeddable, dependency-light (D3 + TopoJSON) map of where graduates go to college.
 *
 * Usage (script embed):
 *   <div data-dcp-college-map></div>
 *   <script src="https://<host>/dcp-college-map.js" defer></script>
 *
 * Optional attributes on the container:
 *   data-base="https://<host>/"   where data/, logos/ and vendor/ live (defaults to the script's folder)
 *   data-title="..."              heading text
 *   data-data="data/matriculation.json"   data file, relative to base
 *
 * Programmatic: DCPCollegeMap.init(element, { base, title, data })
 *
 * Single-file build: scripts/bundle.py wraps this file together with D3, the map shapes, the data
 * and the logos into dist/dcp-college-map.bundle.js, exposing them as window.DCP_COLLEGE_MAP_BUNDLE
 * so nothing else needs to be hosted alongside it.
 */
(function () {
  "use strict";

  var SCRIPT_BASE = (function () {
    var s = document.currentScript || (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (/dcp-college-map[^\/]*\.js/.test(all[i].src || "")) return all[i];
      }
      return null;
    })();
    if (!s || !s.src) return "./";
    return s.src.replace(/[^\/]*$/, "");
  })();

  // ISO 3166-1 alpha-2 -> numeric id used by world-atlas
  var ISO_NUM = {
    US: "840", CA: "124", MX: "484", GB: "826", IE: "372", IT: "380", ES: "724", FR: "250",
    CH: "756", NL: "528", HR: "191", DE: "276", PT: "620", BE: "056", AT: "040", SE: "752",
    DK: "208", NO: "578", CZ: "203", PL: "616", GR: "300", AU: "036", NZ: "554", JP: "392",
    KR: "410", CN: "156", HK: "344", SG: "702", IN: "356", IL: "376", FI: "246", HU: "348",
    IS: "352", TR: "792", AR: "032", BR: "076", CL: "152", CO: "170", PE: "604", ZA: "710",
    AE: "784", QA: "634", TW: "158", TH: "764", PH: "608", VN: "704", DO: "214", JM: "388",
    BS: "044", CR: "188", PA: "591", EG: "818", MA: "504", KE: "404", NG: "566", GH: "288",
  };

  // Where each international inset ("cutout") looks. Regions come from the data file.
  var REGION_VIEWS = {
    "Canada":                { bbox: [[-141, 41], [-52, 70]], rotate: [95, 0] },
    "Mexico & Caribbean":    { bbox: [[-118, 7], [-59, 33]] },
    "Europe":                { bbox: [[-11, 35], [32, 62]], rotate: [-10, 0] },
    "Asia & Pacific":        { bbox: [[60, -48], [180, 55]] },
    "Middle East & Africa":  { bbox: [[-20, -36], [60, 42]] },
    "Other International":   { bbox: [[-170, -56], [180, 80]] },
    "South America":         { bbox: [[-82, -56], [-34, 13]] },
  };

  // East Coast states too small to hover or click on the overview (DC is a couple of pixels wide).
  // Each gets a labelled tile out in the Atlantic, north to south, as on election maps.
  var SMALL_STATES = [
    ["RI", "Rhode Island"], ["CT", "Connecticut"], ["NJ", "New Jersey"],
    ["DE", "Delaware"], ["MD", "Maryland"], ["DC", "District of Columbia"],
  ];
  var SMALL_CODES = {};
  SMALL_STATES.forEach(function (s) { SMALL_CODES[s[0]] = true; });

  // DePaul College Prep, 3333 N Rockwell St, Chicago
  var HOME = { name: "DePaul Prep", lat: 41.9426, lon: -87.6935, state: "IL" };

  var COLORS = ["#e9eff4", "#c8dcea", "#9dc3dd", "#6b9fc4", "#3b6f9d", "#0e406a"];
  var BREAKS = [1, 3, 10, 30, 100]; // students; 0 is its own bucket

  /* ------------------------------------------------------------------ bootstrap */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }
  function bundle() { return window.DCP_COLLEGE_MAP_BUNDLE || null; }
  function ensureDeps(base) {
    var B = bundle();
    if (B && B.css) {
      if (!document.getElementById("dcpcm-style")) {
        var st = document.createElement("style");
        st.id = "dcpcm-style"; st.textContent = B.css;
        document.head.appendChild(st);
      }
    } else {
      loadCss(base + "dcp-college-map.css");
    }
    loadCss("https://fonts.googleapis.com/css2?family=Libre+Bodoni:wght@500;600&family=Source+Sans+3:wght@400;600;700&display=swap");
    var p = Promise.resolve();
    if (!window.d3 || !window.d3.geoAlbersUsa) p = p.then(function () { return loadScript(base + "vendor/d3.v7.min.js"); });
    if (!window.topojson) p = p.then(function () { return loadScript(base + "vendor/topojson-client.min.js"); });
    return p;
  }
  function fetchJson(url) {
    return fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + url + " (" + r.status + ")");
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function initials(name) {
    var words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(function (w) {
      return w && !/^(of|the|at|and|in|for|de|del|di|la|le)$/i.test(w);
    });
    return words.slice(0, 3).map(function (w) { return w[0].toUpperCase(); }).join("");
  }

  /* ------------------------------------------------------------------ the control */
  function CollegeMap(root, opts) {
    this.root = root;
    this.opts = opts;
    this.base = opts.base;
    this.year = "all";
    this.selection = null;   // { kind: "state"|"country", code, name, feature }
    this.activePin = null;
    this.sticky = false;
    this.build();
  }

  CollegeMap.prototype.build = function () {
    var root = this.root;
    root.classList.add("dcpcm");
    root.innerHTML =
      '<div class="dcpcm-header">' +
      '  <div><h2 class="dcpcm-title"></h2><p class="dcpcm-subtitle"></p></div>' +
      '  <div class="dcpcm-years" role="group" aria-label="Filter by graduating class"></div>' +
      '</div>' +
      '<div class="dcpcm-body">' +
      '  <div class="dcpcm-stage">' +
      '    <div class="dcpcm-view dcpcm-overview"></div>' +
      '    <div class="dcpcm-view dcpcm-detail" hidden></div>' +
      '    <div class="dcpcm-loading">Loading map…</div>' +
      '  </div>' +
      '  <div class="dcpcm-insets"></div>' +
      '  <aside class="dcpcm-panel"><div class="dcpcm-panel-inner"></div></aside>' +
      '</div>' +
      '<div class="dcpcm-tip" role="tooltip"></div>' +
      '<div class="dcpcm-sr" aria-live="polite"></div>';
    this.el = {
      title: root.querySelector(".dcpcm-title"),
      subtitle: root.querySelector(".dcpcm-subtitle"),
      years: root.querySelector(".dcpcm-years"),
      stage: root.querySelector(".dcpcm-stage"),
      overview: root.querySelector(".dcpcm-overview"),
      detail: root.querySelector(".dcpcm-detail"),
      loading: root.querySelector(".dcpcm-loading"),
      insets: root.querySelector(".dcpcm-insets"),
      panel: root.querySelector(".dcpcm-panel-inner"),
      tip: root.querySelector(".dcpcm-tip"),
      live: root.querySelector(".dcpcm-sr"),
    };
    this.el.title.textContent = this.opts.title;

    var self = this, B = bundle();
    var sources = B && B.data ? [B.data, B.states, B.countries] : [
      fetchJson(this.base + this.opts.data),
      fetchJson(this.base + "vendor/states-10m.json"),
      fetchJson(this.base + "vendor/countries-50m.json"),
    ];
    Promise.all(sources).then(function (res) {
      self.data = res[0];
      self.usTopo = res[1];
      self.worldTopo = res[2];
      self.prepare();
      self.el.loading.remove();
      self.renderYears();
      self.renderAll();
      self.observeResize();
    }).catch(function (err) {
      self.el.loading.className = "dcpcm-error";
      self.el.loading.textContent = "Sorry, the college map could not be loaded. " + err.message;
      if (window.console) console.error(err);
    });

    root.addEventListener("click", function (e) {
      if (self.sticky && !e.target.closest(".dcpcm-pin") && !e.target.closest(".dcpcm-tip")) self.hideTip(true);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && self.selection && root.contains(document.activeElement)) self.select(null);
    });
  };

  CollegeMap.prototype.prepare = function () {
    var tj = window.topojson;
    this.states = tj.feature(this.usTopo, this.usTopo.objects.states).features;
    this.stateMesh = tj.mesh(this.usTopo, this.usTopo.objects.states, function (a, b) { return a !== b; });
    this.countries = tj.feature(this.worldTopo, this.worldTopo.objects.countries).features;
    this.countryById = {};
    this.countries.forEach(function (f) { this.countryById[String(f.id)] = f; }, this);

    // us-atlas states carry FIPS ids + names; map postal codes to features
    var byName = this.stateByName = {};
    this.states.forEach(function (f) { byName[f.properties.name] = f; });
    this.stateByCode = {};
    var self = this;
    this.data.schools.forEach(function (s) {
      if (s.country === "US" && s.stateName && byName[s.stateName]) self.stateByCode[s.state] = byName[s.stateName];
    });
    this.codeByStateName = {};
    Object.keys(this.stateByCode).forEach(function (c) { self.codeByStateName[self.stateByCode[c].properties.name] = c; });

    this.regions = [];
    var seen = {};
    this.data.schools.forEach(function (s) {
      if (s.country !== "US" && !seen[s.region]) { seen[s.region] = true; self.regions.push(s.region); }
    });
    var order = Object.keys(REGION_VIEWS);
    this.regions.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });

    this.color = window.d3.scaleThreshold().domain(BREAKS).range(COLORS);
  };

  /* ------------------------------------------------------------------ data helpers */
  CollegeMap.prototype.count = function (s) {
    return this.year === "all" ? s.total : (s.byYear[this.year] || 0);
  };
  CollegeMap.prototype.activeSchools = function () {
    var self = this;
    return this.data.schools.filter(function (s) { return self.count(s) > 0; });
  };
  CollegeMap.prototype.schoolsIn = function (kind, code) {
    var self = this;
    return this.activeSchools().filter(function (s) {
      return kind === "state" ? (s.country === "US" && s.state === code) : (s.country !== "US" && s.country === code);
    }).sort(function (a, b) { return self.count(b) - self.count(a) || a.name.localeCompare(b.name); });
  };
  CollegeMap.prototype.totals = function () {
    var self = this, byState = {}, byCountry = {}, byRegion = {};
    this.activeSchools().forEach(function (s) {
      var n = self.count(s);
      if (s.country === "US") byState[s.state] = (byState[s.state] || 0) + n;
      else {
        byCountry[s.country] = (byCountry[s.country] || 0) + n;
        byRegion[s.region] = (byRegion[s.region] || 0) + n;
      }
    });
    return { byState: byState, byCountry: byCountry, byRegion: byRegion };
  };

  /* ------------------------------------------------------------------ header */
  CollegeMap.prototype.renderYears = function () {
    var self = this, el = this.el.years;
    el.innerHTML = "";
    // most recent class first
    var opts = [{ v: "all", label: "All classes" }].concat(this.data.years.slice().reverse().map(function (y) {
      return { v: y, label: "Class of " + y };
    }));
    opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.setAttribute("aria-pressed", String(o.v === self.year));
      b.addEventListener("click", function () {
        if (self.year === o.v) return;
        self.year = o.v;
        el.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        self.hideTip(true);
        self.renderAll();
      });
      el.appendChild(b);
    });
  };

  CollegeMap.prototype.renderSubtitle = function () {
    var schools = this.activeSchools();
    var students = schools.reduce(function (a, s) { return a + this.count(s); }.bind(this), 0);
    var ys = this.data.years;
    var who = this.year === "all"
      ? (ys.length > 1 ? "Classes of " + ys[0] + "–" + ys[ys.length - 1] : "Class of " + ys[0])
      : "Class of " + this.year;
    this.el.subtitle.textContent = who + " · " + plural(students, "graduate") + " · " + plural(schools.length, "college", "colleges and universities");
  };

  /* ------------------------------------------------------------------ rendering */
  CollegeMap.prototype.renderAll = function () {
    this.renderSubtitle();
    this.renderOverview();
    this.renderInsets();
    if (this.selection) this.renderDetail(); else this.renderPanel();
  };

  CollegeMap.prototype.renderOverview = function () {
    var d3 = window.d3, self = this;
    var box = this.el.stage.getBoundingClientRect();
    var W = Math.max(320, box.width), H = Math.max(260, box.height);
    var t = this.totals();
    this.el.overview.innerHTML = "";

    var svg = d3.select(this.el.overview).append("svg")
      .attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img")
      .attr("aria-label", "Map of the United States shaded by the number of DePaul Prep graduates attending college in each state");
    // the right margin leaves room in the Atlantic for the small-state tiles
    var proj = d3.geoAlbersUsa().fitExtent([[12, 12], [W - 36, H - 36]], { type: "FeatureCollection", features: this.states });
    var path = d3.geoPath(proj);
    this.overviewProj = proj;

    var g = svg.append("g");
    g.selectAll("path.dcpcm-state")
      .data(this.states)
      .join("path")
      .attr("class", function (f) {
        var code = self.codeByStateName[f.properties.name];
        return "dcpcm-state " + (code && t.byState[code] ? "has-data" : "no-data");
      })
      .attr("d", path)
      .attr("fill", function (f) {
        var code = self.codeByStateName[f.properties.name];
        return self.color(code ? (t.byState[code] || 0) : 0);
      })
      // keyboard users reach the small states through their tiles instead
      .attr("tabindex", function (f) { var c = self.codeByStateName[f.properties.name]; return c && t.byState[c] && !SMALL_CODES[c] ? 0 : null; })
      .attr("role", function (f) { var c = self.codeByStateName[f.properties.name]; return c && t.byState[c] && !SMALL_CODES[c] ? "button" : null; })
      .attr("aria-label", function (f) {
        var c = self.codeByStateName[f.properties.name], n = c ? (t.byState[c] || 0) : 0;
        return f.properties.name + ": " + plural(n, "graduate") + (n ? ". Press Enter to see schools." : "");
      })
      .on("mousemove", function (e, f) { self.showRegionTip(e, "state", self.codeByStateName[f.properties.name], f.properties.name); })
      .on("mouseleave", function () { self.hideTip(); })
      .on("click", function (e, f) {
        var c = self.codeByStateName[f.properties.name];
        if (c && t.byState[c]) self.select({ kind: "state", code: c, name: f.properties.name, feature: f });
      })
      .on("keydown", function (e, f) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d3.select(this).dispatch("click"); }
      });
    g.append("path").attr("class", "dcpcm-mesh").attr("d", path(this.stateMesh));
    this.renderSmallStateTiles(svg, path, W, t);

    // home star
    var hp = proj([HOME.lon, HOME.lat]);
    if (hp) {
      var home = svg.append("g").attr("class", "dcpcm-home").attr("transform", "translate(" + hp[0] + "," + hp[1] + ")");
      home.append("path").attr("class", "star").attr("d", starPath(6));
    }

    // legend
    var legend = document.createElement("div");
    legend.className = "dcpcm-legend";
    var labels = ["0", "1–2", "3–9", "10–29", "30–99", "100+"];
    legend.innerHTML = '<span>Graduates</span><div class="swatches">' + COLORS.map(function (c, i) {
      return '<div class="swatch" style="background:' + c + '" title="' + labels[i] + '"><span>' + labels[i] + '</span></div>';
    }).join("") + "</div>";
    this.el.overview.appendChild(legend);
    var hint = document.createElement("div");
    hint.className = "dcpcm-hint";
    hint.textContent = "Hover a state for details · click to see schools";
    this.el.overview.appendChild(hint);
  };

  CollegeMap.prototype.renderSmallStateTiles = function (svg, path, W, t) {
    var d3 = window.d3, self = this;
    // only states with graduates (in the selected class) get a tile
    var tiles = SMALL_STATES.map(function (st) {
      var f = self.stateByName[st[1]], n = t.byState[st[0]] || 0;
      if (!f || !n) return null;
      var c = path.centroid(f);
      return { code: st[0], name: st[1], f: f, n: n, cx: c[0], cy: c[1], right: path.bounds(f)[1][0] };
    }).filter(Boolean);
    if (!tiles.length) return;

    // A column just off the NJ/DE/MD coast, centred on the states it labels but kept below Cape Cod.
    var tw = 26, th = 15, gap = 4, colH = tiles.length * (th + gap) - gap;
    var coast = d3.max(["New Jersey", "Delaware", "Maryland"], function (n) {
      return self.stateByName[n] ? path.bounds(self.stateByName[n])[1][0] : -Infinity;
    });
    var x = Math.min(W - tw - 6, coast + 14);
    var ma = this.stateByName.Massachusetts;
    var y = (d3.min(tiles, function (d) { return d.cy; }) + d3.max(tiles, function (d) { return d.cy; })) / 2 - colH / 2;
    if (ma) y = Math.max(y, path.bounds(ma)[1][1] + 6);
    tiles.forEach(function (d, i) { d.x = x; d.y = y + i * (th + gap); });

    // the state shape each tile stands for, looked up once so hovering doesn't rescan the map
    svg.selectAll("path.dcpcm-state").each(function (f) {
      tiles.forEach(function (d) { if (d.f === f) d.shape = this; }, this);
    });
    var g = svg.append("g").attr("class", "dcpcm-tiles");
    var tile = g.selectAll("g.dcpcm-tile").data(tiles).join("g")
      .attr("class", "dcpcm-tile")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", function (d) { return d.name + ": " + plural(d.n, "graduate") + ". Press Enter to see schools."; })
      .on("mouseenter", function (e, d) { if (d.shape) d.shape.classList.add("is-hovered"); })
      .on("mousemove", function (e, d) { self.showRegionTip(e, "state", d.code, d.name); })
      .on("mouseleave", function (e, d) { if (d.shape) d.shape.classList.remove("is-hovered"); self.hideTip(); })
      .on("click", function (e, d) { self.select({ kind: "state", code: d.code, name: d.name, feature: d.f }); })
      .on("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d3.select(this).dispatch("click"); }
      });
    tile.append("line").attr("class", "leader")
      .attr("x1", function (d) { return d.cx; }).attr("y1", function (d) { return d.cy; })
      .attr("x2", function (d) { return d.x; }).attr("y2", function (d) { return d.y + th / 2; });
    tile.append("circle").attr("class", "end").attr("r", 1.6)
      .attr("cx", function (d) { return d.cx; }).attr("cy", function (d) { return d.cy; });
    tile.append("rect").attr("rx", 3).attr("width", tw).attr("height", th)
      .attr("x", function (d) { return d.x; }).attr("y", function (d) { return d.y; })
      .attr("fill", function (d) { return self.color(d.n); });
    tile.append("text").attr("x", function (d) { return d.x + tw / 2; }).attr("y", function (d) { return d.y + th / 2; })
      .attr("dy", "0.35em")
      .classed("on-dark", function (d) { return d3.hsl(self.color(d.n)).l < 0.55; })
      .text(function (d) { return d.code; });
  };

  CollegeMap.prototype.renderInsets = function () {
    var d3 = window.d3, self = this, t = this.totals();
    var wrap = this.el.insets;
    wrap.innerHTML = "";
    this.regions.forEach(function (region) {
      var view = REGION_VIEWS[region] || REGION_VIEWS["Other International"];
      var div = document.createElement("div");
      div.className = "dcpcm-inset";
      var label = document.createElement("div");
      label.className = "dcpcm-inset-label";
      label.innerHTML = esc(region) + "<span>" + plural(t.byRegion[region] || 0, "grad") + "</span>";
      div.appendChild(label);
      wrap.appendChild(div);

      var W = 190, H = 128;
      var svg = d3.select(div).append("svg").attr("viewBox", "0 0 " + W + " " + H)
        .attr("role", "img").attr("aria-label", region + " inset map");
      var bboxFeature = bboxPolygon(view.bbox);
      var proj = d3.geoMercator();
      if (view.rotate) proj.rotate(view.rotate);
      proj.fitExtent([[4, 22], [W - 4, H - 4]], bboxFeature);
      proj.clipExtent([[0, 0], [W, H]]);
      var path = d3.geoPath(proj);

      // countries with data in this region (by numeric id) — used to decide interactivity
      var codesHere = {};
      self.activeSchools().forEach(function (s) { if (s.region === region) codesHere[s.country] = s.countryName; });
      var numToCode = {};
      Object.keys(codesHere).forEach(function (c) { if (ISO_NUM[c]) numToCode[ISO_NUM[c]] = c; });

      svg.append("g").selectAll("path")
        .data(self.countries.filter(function (f) { return pathIntersects(path, f); }))
        .join("path")
        .attr("class", function (f) { return "dcpcm-state " + (numToCode[String(f.id)] ? "has-data" : "no-data"); })
        .attr("d", path)
        .attr("fill", function (f) { var c = numToCode[String(f.id)]; return self.color(c ? (t.byCountry[c] || 0) : 0); })
        .attr("tabindex", function (f) { return numToCode[String(f.id)] ? 0 : null; })
        .attr("role", function (f) { return numToCode[String(f.id)] ? "button" : null; })
        .attr("aria-label", function (f) {
          var c = numToCode[String(f.id)];
          return c ? codesHere[c] + ": " + plural(t.byCountry[c] || 0, "graduate") + ". Press Enter to see schools." : null;
        })
        .on("mousemove", function (e, f) {
          var c = numToCode[String(f.id)];
          if (c) self.showRegionTip(e, "country", c, codesHere[c]);
        })
        .on("mouseleave", function () { self.hideTip(); })
        .on("click", function (e, f) {
          var c = numToCode[String(f.id)];
          if (c) self.select({ kind: "country", code: c, name: codesHere[c], feature: f });
        })
        .on("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d3.select(this).dispatch("click"); }
        });
    });
  };

  /* ------------------------------------------------------------------ selection / detail view */
  CollegeMap.prototype.select = function (sel) {
    var self = this;
    this.hideTip(true);
    this.activePin = null;
    var from = sel ? this.el.overview : this.el.detail;
    var to = sel ? this.el.detail : this.el.overview;
    this.selection = sel;
    if (sel) this.renderDetail(); else this.renderPanel();
    this.el.live.textContent = sel ? sel.name + " selected. " + plural(this.schoolsIn(sel.kind, sel.code).length, "school") + " shown." : "Showing the full map.";

    // cross-fade between views
    to.hidden = false;
    to.classList.add("is-entering");
    from.classList.add("is-leaving");
    requestAnimationFrame(function () { requestAnimationFrame(function () { to.classList.remove("is-entering"); }); });
    setTimeout(function () {
      from.classList.remove("is-leaving");
      from.hidden = true;
      if (sel) { var b = self.el.detail.querySelector(".dcpcm-back"); if (b) b.focus({ preventScroll: true }); }
    }, 460);
  };

  CollegeMap.prototype.renderDetail = function () {
    var d3 = window.d3, self = this, sel = this.selection;
    var box = this.el.stage.getBoundingClientRect();
    var W = Math.max(320, box.width), H = Math.max(260, box.height);
    var schools = this.schoolsIn(sel.kind, sel.code);
    var total = schools.reduce(function (a, s) { return a + self.count(s); }, 0);
    this.el.detail.innerHTML = "";

    var svg = d3.select(this.el.detail).append("svg").attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img").attr("aria-label", "Map of " + sel.name + " with a flag for each college attended by DePaul Prep graduates");
    var proj = sel.kind === "state"
      ? d3.geoAlbers().rotate([-d3.geoCentroid(sel.feature)[0], 0]).parallels([29.5, 45.5])
      : d3.geoMercator();
    // leave room for the title bar at the top and pins that extend above their point
    var extent = [[50, 80], [W - 50, H - 34]];
    proj.fitExtent(extent, sel.feature);
    if (sel.kind !== "state") {
      // A country can be far larger than the area its schools occupy (Canada vs. southern Ontario).
      // If fitting the whole country would leave the schools in a tiny cluster, fit a padded box
      // around the schools instead; neighbouring countries stay visible as context.
      var located = schools.filter(function (s) { return s.lat != null && s.lon != null; });
      if (located.length) {
        var lons = located.map(function (s) { return s.lon; }), lats = located.map(function (s) { return s.lat; });
        var cLon = (Math.min.apply(null, lons) + Math.max.apply(null, lons)) / 2;
        var cLat = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
        var aspect = (extent[1][0] - extent[0][0]) / (extent[1][1] - extent[0][1]);
        var spanLat = Math.max(5, (Math.max.apply(null, lats) - Math.min.apply(null, lats)) * 1.8);
        var spanLon = Math.max(spanLat * aspect / Math.cos(cLat * Math.PI / 180),
                               (Math.max.apply(null, lons) - Math.min.apply(null, lons)) * 1.8);
        var zoomed = d3.geoMercator().fitExtent(extent, bboxPolygon(
          [[cLon - spanLon / 2, Math.max(-85, cLat - spanLat / 2)], [cLon + spanLon / 2, Math.min(85, cLat + spanLat / 2)]]));
        if (zoomed.scale() > proj.scale() * 2.5) proj = zoomed;
      }
    }
    proj.clipExtent([[0, 0], [W, H]]);
    var path = d3.geoPath(proj);

    var context = sel.kind === "state" ? this.states : this.countries;
    var ctxG = svg.append("g");
    ctxG.selectAll("path").data(context.filter(function (f) { return f !== sel.feature; }))
      .join("path").attr("class", "dcpcm-context").attr("d", path)
      .on("click", function () { self.select(null); });
    svg.append("path").datum(sel.feature).attr("class", "dcpcm-focus").attr("d", path);

    // pins, nudged apart so clustered schools stay readable
    var pins = schools.filter(function (s) { return s.lat != null && s.lon != null; }).map(function (s) {
      var p = proj([s.lon, s.lat]);
      var n = self.count(s);
      var scale = 1 + Math.min(1, Math.sqrt(n) / 6);   // 1x for 1 student, ~2x for 36+
      return { s: s, n: n, tx: p ? p[0] : null, ty: p ? p[1] : null, x: p ? p[0] : 0, y: p ? p[1] : 0,
               w: Math.round(18 * scale), h: Math.round(12 * scale), pole: Math.round(22 * scale) };
    }).filter(function (p) { return p.tx != null; });
    if (pins.length > 1) {
      d3.forceSimulation(pins)
        .force("x", d3.forceX(function (d) { return d.tx; }).strength(0.6))
        .force("y", d3.forceY(function (d) { return d.ty; }).strength(0.6))
        .force("collide", d3.forceCollide(function (d) { return Math.max(d.w, d.h) * 0.75 + 3; }).strength(0.9).iterations(3))
        .stop().tick(160);
    }
    pins.forEach(function (d) {  // keep every flag fully inside the stage
      d.x = Math.max(10, Math.min(W - d.w - 10, d.x));
      d.y = Math.max(d.pole + 48, Math.min(H - 10, d.y));
    });
    var pinG = svg.append("g").attr("class", "dcpcm-pins");
    var pin = pinG.selectAll("g.dcpcm-pin").data(pins).join("g")
      .attr("class", "dcpcm-pin")
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", function (d) { return d.s.name + ": " + plural(d.n, "graduate"); })
      .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
    pin.filter(function (d) { return Math.hypot(d.x - d.tx, d.y - d.ty) > 5; })
      .append("line").attr("class", "leader")
      .attr("x1", 0).attr("y1", 0).attr("x2", function (d) { return d.tx - d.x; }).attr("y2", function (d) { return d.ty - d.y; });
    // the base dot always sits on the school's true location, even when the flag was nudged away
    pin.append("circle").attr("class", "base").attr("r", 2.2)
      .attr("cx", function (d) { return d.tx - d.x; }).attr("cy", function (d) { return d.ty - d.y; });
    pin.append("line").attr("class", "pole").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", function (d) { return -d.pole; });
    pin.append("path").attr("class", "flag").attr("d", function (d) {
      // a swallow-tail pennant
      var w = d.w, h = d.h, notch = Math.round(h * 0.28);
      return "M0," + (-d.pole) + " h" + w + " l" + (-notch) + "," + (h / 2) + " l" + notch + "," + (h / 2) + " h" + (-w) + " z";
    });
    pin.append("text").attr("class", "count")
      .attr("x", function (d) { return d.w * 0.44; })
      .attr("y", function (d) { return -d.pole + d.h * 0.5; })
      .attr("dy", "0.36em")
      .attr("font-size", function (d) { return Math.round(d.h * 0.8); })
      .text(function (d) { return d.n; });
    pin.on("mousemove", function (e, d) { if (!self.sticky) self.showSchoolTip(e, d.s, this); })
      .on("mouseleave", function () { if (!self.sticky) self.hideTip(); self.highlightPin(null); })
      .on("mouseenter", function (e, d) { self.highlightPin(d.s.id); })
      .on("click", function (e, d) { e.stopPropagation(); self.showSchoolTip(e, d.s, this, true); })
      .on("focus", function (e, d) { self.showSchoolTip(e, d.s, this); self.highlightPin(d.s.id); })
      .on("blur", function () { if (!self.sticky) self.hideTip(); });

    // home star when looking at Illinois
    if (sel.kind === "state" && sel.code === HOME.state) {
      var hp = proj([HOME.lon, HOME.lat]);
      var home = svg.append("g").attr("class", "dcpcm-home").attr("transform", "translate(" + hp[0] + "," + hp[1] + ")");
      home.append("path").attr("class", "star").attr("d", starPath(7));
      home.append("text").attr("x", 10).attr("dy", "0.35em").text(HOME.name);
    }

    var bar = document.createElement("div");
    bar.className = "dcpcm-detail-bar";
    bar.innerHTML = '<button type="button" class="dcpcm-back" aria-label="Back to the full map">&larr; Back to map</button>' +
      '<div class="dcpcm-detail-title">' + esc(sel.name) + '<small>' + plural(total, "graduate") + " · " + plural(schools.length, "school") + "</small></div>";
    bar.querySelector(".dcpcm-back").addEventListener("click", function () { self.select(null); });
    this.el.detail.appendChild(bar);
    var hint = document.createElement("div");
    hint.className = "dcpcm-hint";
    hint.textContent = "Hover or tap a flag to see the school";
    this.el.detail.appendChild(hint);

    this.renderPanel();
  };

  CollegeMap.prototype.highlightPin = function (id) {
    this.activePin = id;
    this.el.detail.querySelectorAll(".dcpcm-pin").forEach(function (p) {
      p.classList.toggle("is-active", id != null && p.__data__ && p.__data__.s.id === id);
    });
    this.el.panel.querySelectorAll(".dcpcm-list button[data-id]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-id") === id);
    });
  };

  /* ------------------------------------------------------------------ side panel */
  CollegeMap.prototype.logoHtml = function (s, size) {
    if (s.logo) {
      var src = /^(data:|https?:)/.test(s.logo) ? s.logo : this.base + s.logo;
      return '<span class="dcpcm-logo"><img src="' + esc(src) + '" alt="" loading="lazy" ' +
        'onload="if(this.naturalWidth&&this.naturalWidth<=32)this.classList.add(\'is-tiny\')" ' +
        'onerror="this.parentNode.className=\'dcpcm-logo is-initials\';this.parentNode.textContent=\'' + esc(initials(s.name)) + '\'"></span>';
    }
    return '<span class="dcpcm-logo is-initials" aria-hidden="true">' + esc(initials(s.name)) + "</span>";
  };

  CollegeMap.prototype.schoolListHtml = function (schools, limit, withPlace) {
    var self = this;
    var shown = limit ? schools.slice(0, limit) : schools;
    var html = '<ol class="dcpcm-list">' + shown.map(function (s) {
      var place = s.country === "US" ? s.city + ", " + s.state : s.city + (s.city ? ", " : "") + s.countryName;
      return "<li><button type=\"button\" data-id=\"" + esc(s.id) + "\" data-kind=\"" + (s.country === "US" ? "state" : "country") +
        "\" data-code=\"" + esc(s.country === "US" ? s.state : s.country) + "\">" + self.logoHtml(s) +
        '<span class="name">' + esc(s.name) + (withPlace ? "<small>" + esc(place) + "</small>" : "") + "</span>" +
        '<span class="n">' + self.count(s) + "</span></button></li>";
    }).join("") + "</ol>";
    if (limit && schools.length > limit) html += '<p class="dcpcm-more">and ' + plural(schools.length - limit, "more school") + " — click a state to explore.</p>";
    return html;
  };

  CollegeMap.prototype.renderPanel = function () {
    var self = this, sel = this.selection, p = this.el.panel;
    var schools = sel ? this.schoolsIn(sel.kind, sel.code) : this.activeSchools().slice().sort(function (a, b) {
      return self.count(b) - self.count(a) || a.name.localeCompare(b.name);
    });
    var students = schools.reduce(function (a, s) { return a + self.count(s); }, 0);
    var html;
    if (sel) {
      html = '<p class="dcpcm-kicker">' + (sel.kind === "state" ? "State" : "Country") + "</p><h3>" + esc(sel.name) + "</h3>" +
        '<div class="dcpcm-stats"><div class="dcpcm-stat"><b>' + students + "</b><span>graduates</span></div>" +
        '<div class="dcpcm-stat"><b>' + schools.length + "</b><span>" + (schools.length === 1 ? "school" : "schools") + "</span></div></div>" +
        "<h4>Schools</h4>" + this.schoolListHtml(schools, 0, true);
    } else {
      var t = this.totals();
      var nStates = Object.keys(t.byState).length, nCountries = Object.keys(t.byCountry).length;
      html = '<p class="dcpcm-kicker">' + (this.year === "all" ? "All classes" : "Class of " + this.year) + "</p><h3>At a glance</h3>" +
        '<div class="dcpcm-stats">' +
        '<div class="dcpcm-stat"><b>' + students + "</b><span>graduates</span></div>" +
        '<div class="dcpcm-stat"><b>' + schools.length + "</b><span>colleges &amp; universities</span></div>" +
        '<div class="dcpcm-stat"><b>' + nStates + "</b><span>states" + (t.byState.DC ? " + DC" : "") + "</span></div>" +
        '<div class="dcpcm-stat"><b>' + (nCountries + 1) + "</b><span>countries</span></div></div>" +
        "<h4>Most attended</h4>" + this.schoolListHtml(schools, 12, true);
    }
    html += '<p class="dcpcm-footnote">Counts are graduates who enrolled at each school' +
      (this.data.generated ? ". Updated " + esc(formatDate(this.data.generated)) : "") + ".</p>";
    p.innerHTML = html;

    p.querySelectorAll(".dcpcm-list button").forEach(function (b) {
      var id = b.getAttribute("data-id");
      if (sel) {
        b.addEventListener("mouseenter", function () { self.highlightPin(id); });
        b.addEventListener("mouseleave", function () { self.highlightPin(null); });
        b.addEventListener("click", function () {
          var pin = Array.prototype.find.call(self.el.detail.querySelectorAll(".dcpcm-pin"), function (x) { return x.__data__.s.id === id; });
          if (pin) { pin.focus({ preventScroll: true }); self.showSchoolTip(null, pin.__data__.s, pin, true); }
        });
      } else {
        b.addEventListener("click", function () {
          var kind = b.getAttribute("data-kind"), code = b.getAttribute("data-code");
          var feature = kind === "state" ? self.stateByCode[code] : self.countryById[ISO_NUM[code]];
          var name = kind === "state" ? (feature && feature.properties.name) : null;
          if (!name) { var s = self.data.schools.find(function (x) { return x.id === id; }); name = s && s.countryName; }
          if (feature) self.select({ kind: kind, code: code, name: name, feature: feature });
        });
      }
    });
  };

  /* ------------------------------------------------------------------ tooltips */
  CollegeMap.prototype.showRegionTip = function (e, kind, code, name) {
    if (!code) { this.hideTip(); return; }
    var self = this;
    var schools = this.schoolsIn(kind, code);
    if (!schools.length) { this.hideTip(); return; }
    var n = schools.reduce(function (a, s) { return a + self.count(s); }, 0);
    var top = schools.slice(0, 5);
    this.el.tip.innerHTML = "<h5>" + esc(name) + '</h5><p class="sub">' + plural(n, "graduate") + " · " + plural(schools.length, "school") + "</p>" +
      "<ol>" + top.map(function (s) { return "<li><span>" + esc(s.name) + "</span><span>" + self.count(s) + "</span></li>"; }).join("") + "</ol>" +
      (schools.length > 5 ? '<p class="sub" style="margin:6px 0 0">+ ' + plural(schools.length - 5, "more school") + " · click to explore</p>" : "");
    this.positionTip(e);
  };

  CollegeMap.prototype.showSchoolTip = function (e, s, pinEl, sticky) {
    var self = this;
    // With all classes shown, always break the count down by class (newest first) so every school
    // reads the same way; with one class selected the big number already is that class's count.
    // Rows with no class year are counted under "unknown"; list those last.
    var years = this.year === "all"
      ? "By class: " + Object.keys(s.byYear).sort(function (a, b) {
          return (/^\d+$/.test(b) ? +b : -1) - (/^\d+$/.test(a) ? +a : -1);
        }).map(function (y) {
          return (/^\d{4}$/.test(y) ? "’" + y.slice(-2) : "class unknown") + ": " + s.byYear[y];
        }).join(" · ") : "";
    var place = s.country === "US" ? s.city + ", " + s.state : (s.city ? s.city + ", " : "") + s.countryName;
    this.el.tip.innerHTML = (sticky ? '<button type="button" class="close" aria-label="Close">×</button>' : "") +
      '<div class="school">' + this.logoHtml(s) + "<div><h5>" + esc(s.name) + '</h5><p class="sub" style="margin:0">' + esc(place) + "</p>" +
      '<div class="big">' + this.count(s) + "<small>" + (this.count(s) === 1 ? "graduate" : "graduates") + "</small></div>" +
      (years ? '<div class="years">' + years + "</div>" : "") + "</div></div>";
    this.sticky = !!sticky;
    this.el.tip.classList.toggle("is-sticky", this.sticky);
    if (sticky) this.el.tip.querySelector(".close").addEventListener("click", function () { self.hideTip(true); });
    this.highlightPin(s.id);
    if (e && e.clientX != null && !sticky) this.positionTip(e);
    else this.positionTipAt(pinEl);
  };

  CollegeMap.prototype.positionTipAt = function (pinEl) {
    var r = pinEl.getBoundingClientRect(), root = this.root.getBoundingClientRect();
    this.positionTip({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, true);
  };

  CollegeMap.prototype.positionTip = function (e, above) {
    var tip = this.el.tip, root = this.root.getBoundingClientRect();
    tip.classList.add("is-visible");
    var x = e.clientX - root.left, y = e.clientY - root.top;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = above ? x - tw / 2 : x + 16, top = above ? y - th - 14 : y + 16;
    if (above && top < 60) top = y + 22;            // no room above the flag: show below it
    if (left + tw > root.width - 8) left = above ? root.width - tw - 8 : x - tw - 16;
    if (left < 8) left = 8;
    if (top + th > root.height - 8) top = y - th - 16;
    if (top < 8) top = 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  };

  CollegeMap.prototype.hideTip = function (force) {
    if (this.sticky && !force) return;
    this.sticky = false;
    this.el.tip.classList.remove("is-visible", "is-sticky");
    if (force) this.highlightPin(null);
  };

  /* ------------------------------------------------------------------ resize + iframe height */
  CollegeMap.prototype.observeResize = function () {
    var self = this, timer;
    var redraw = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = self.el.stage.getBoundingClientRect().width;
        if (Math.abs(w - (self.lastWidth || 0)) < 2) { self.postHeight(); return; }
        self.lastWidth = w;
        self.hideTip(true);
        self.renderOverview();
        if (self.selection) self.renderDetail();
        self.postHeight();
      }, 120);
    };
    if (window.ResizeObserver) new ResizeObserver(redraw).observe(this.root);
    else window.addEventListener("resize", redraw);
    this.lastWidth = this.el.stage.getBoundingClientRect().width;
    this.postHeight();
  };
  CollegeMap.prototype.postHeight = function () {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ type: "dcp-college-map:height", height: document.documentElement.scrollHeight }, "*");
    } catch (e) { /* ignore */ }
  };

  /* ------------------------------------------------------------------ geometry helpers */
  function bboxPolygon(b) {
    // d3-geo expects clockwise rings (spherical winding); anticlockwise would mean "everything but the box"
    return { type: "Polygon", coordinates: [[[b[0][0], b[0][1]], [b[0][0], b[1][1]], [b[1][0], b[1][1]], [b[1][0], b[0][1]], [b[0][0], b[0][1]]]] };
  }
  function pathIntersects(path, f) {
    var b = path.bounds(f);
    return isFinite(b[0][0]) && b[1][0] > b[0][0] && b[1][1] > b[0][1];
  }
  function starPath(r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push((Math.cos(a) * rad).toFixed(2) + "," + (Math.sin(a) * rad).toFixed(2));
    }
    return "M" + pts.join("L") + "Z";
  }
  function formatDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  }

  /* ------------------------------------------------------------------ public API */
  var api = {
    init: function (el, options) {
      options = options || {};
      var base = options.base || el.getAttribute("data-base") || SCRIPT_BASE;
      if (!/\/$/.test(base)) base += "/";
      var opts = {
        base: base,
        title: options.title || el.getAttribute("data-title") || "Where DePaul Prep Graduates Attend College",
        data: options.data || el.getAttribute("data-data") || "data/matriculation.json",
      };
      return ensureDeps(base).then(function () { return new CollegeMap(el, opts); });
    },
    autoInit: function () {
      var targets = document.querySelectorAll("[data-dcp-college-map], #dcp-college-map");
      Array.prototype.forEach.call(targets, function (el) {
        if (el.__dcpcm) return;
        el.__dcpcm = true;
        api.init(el);
      });
    },
  };
  window.DCPCollegeMap = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", api.autoInit);
  else api.autoInit();
})();
