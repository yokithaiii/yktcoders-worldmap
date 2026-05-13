import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import Modal from "./Modal";
import GlobeMap from "./GlobeMap";
import CookieBanner from "./CookieBanner";
import RegisterModal from "./RegisterModal";
import Toast from "./Toast";
import { supabase } from "../lib/supabase";

const FONT = "'JetBrains Mono', monospace";
const BG = "#080808";
const COUNTRY_FILL = "#1e1e1e";
const COUNTRY_STROKE = "#3d3d3d";
const MARKER_FILL = "#96ea28";
const MARKER_HOVER = "#ffffff";
const TOOLTIP_BG = "#111111";
const TEXT_DIM = "#555555";
const TEXT_BRIGHT = "#ffffff";
const ACCENT = "#96ea28";
const CLUSTER_RADIUS = 28;

const normalize = (c) => ({
  id: c.id, name: c.name, city: c.city,
  location: `${c.city}, ${c.country}`,
  countryId: c.country_id,
  coordinates: [c.lng, c.lat],
  github:    c.github?.trim()    || null,
  telegram:  c.telegram?.trim()  || null,
  linkedin:  c.linkedin?.trim()  || null,
  instagram: c.instagram?.trim() || null,
  website:   c.website?.trim()   || null,
  specialization: c.specialization || "",
  company: c.company || "",
  status: c.status?.trim() || null,
});

function buildClusters(coders, projection, zoomK) {
  const placed = [];
  const clusters = [];
  coders.forEach((d) => {
    const [px, py] = projection(d.coordinates);
    const sx = px * zoomK, sy = py * zoomK;
    const existing = placed.find((p) => Math.hypot(p.sx - sx, p.sy - sy) < CLUSTER_RADIUS);
    if (existing) { existing.coders.push(d); }
    else {
      const entry = { sx, sy, px, py, coders: [d] };
      placed.push(entry); clusters.push(entry);
    }
  });
  return clusters;
}

// Тултип с учётом краёв экрана
function SmartTooltip({ tooltip }) {
  if (!tooltip) return null;
  const { x, y, data } = tooltip;
  const W = window.innerWidth, H = window.innerHeight;
  const tipW = 220, tipH = 140;
  const left = x + 14 + tipW > W ? x - tipW - 14 : x + 14;
  const top = y - 10 + tipH > H ? H - tipH - 10 : y - 10;
  return (
    <div style={{
      position: "absolute", left, top,
      background: TOOLTIP_BG, border: "1px solid #222",
      borderRadius: 4, padding: "10px 14px", pointerEvents: "none",
      minWidth: tipW, fontFamily: FONT, boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
    }}>
      <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>root@yakutia:~$ whoami</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{data.name}</div>
      <div style={{ fontSize: 11, color: "#444", marginBottom: 3 }}>→ {data.location}</div>
      {data.specialization && <div style={{ fontSize: 11, color: "#444", marginBottom: 3 }}>→ {data.specialization}</div>}
      {data.company && <div style={{ fontSize: 11, color: "#444", marginBottom: 8 }}>→ {data.company}</div>}
      {data.github && (
        <a href={data.github} target="_blank" rel="noreferrer"
          style={{ fontSize: 11, color: ACCENT, textDecoration: "none", opacity: 0.85 }}>
          github →
        </a>
      )}
    </div>
  );
}

export default function WorldMap() {
  const svgRef = useRef(null);
  const svgNodeRef = useRef(null);
  const gRef = useRef(null);
  const projectionRef = useRef(null);
  const mapWidthRef = useRef(null);
  const mapReadyRef = useRef(false);
  const allCodersRef = useRef([]);
  const codersByCountryRef = useRef({});
  const filteredCountriesRef = useRef([]);
  const tooltipRef = useRef(null);
  const zoomRef = useRef(null);
  const currentZoomKRef = useRef(1);
  const activeSpecRef = useRef(new Set());
  const globeProjectionRef = useRef(null);
  const globeRedrawRef = useRef(null);
  const statusIntervalRef = useRef(null);

  const [useMock, setUseMock] = useState(
    () => localStorage.getItem("useMock") === "true" || import.meta.env.VITE_USE_MOCK === "true"
  );
  const [showGlobe, setShowGlobe] = useState(false);
  const [zenMode, setZenMode] = useState(false);

  const toggleGlobe = () => {
    setLoading(true);
    setTimeout(() => {
      setShowGlobe((v) => !v);
      setLoading(false);
    }, 600);
  };

  const toggleMock = () => {
    setUseMock((prev) => {
      const next = !prev;
      localStorage.setItem("useMock", String(next));
      window.location.reload();
      return next;
    });
  };
  const [specs, setSpecs] = useState([]);
  const [allCoders, setAllCoders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeSpecs, setActiveSpecs] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const getVisible = (coders, specSet) => specSet.size === 0 ? coders : coders.filter((c) => specSet.has(c.specialization));

  const updateSpecs = (codersList) => {
    const unique = [...new Set(codersList.map((c) => c.specialization).filter(Boolean))].sort();
    setSpecs(unique);
  };

  const rebuildCodersByCountry = (codersList) => {
    const map = {};
    codersList.forEach((c) => {
      const country = filteredCountriesRef.current.find((f) => d3.geoContains(f, c.coordinates));
      if (!country) return;
      const key = String(parseInt(country.id));
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    codersByCountryRef.current = map;
  };

  const drawMarkers = useCallback((codersList, zoomK = 1) => {
    const g = gRef.current;
    const projection = projectionRef.current;
    const mapWidth = mapWidthRef.current;
    if (!g || !projection || !mapWidth) return;

    g.selectAll(".marker-group").remove();
    const clusters = buildClusters(codersList, projection, zoomK);

    [-1, 0, 1].forEach((offset) => {
      const mg = g.append("g")
        .attr("class", "marker-group")
        .attr("transform", `translate(${offset * mapWidth}, 0)`);

      clusters.forEach((cl) => {
        const isCluster = cl.coders.length > 1;
        const { px, py } = cl;

        if (isCluster) {
          const grp = mg.append("g").attr("class", "cluster")
            .attr("transform", `translate(${px},${py})`).style("cursor", "pointer");
          const clCircle = grp.append("circle")
            .attr("r", 10 / zoomK).attr("fill", "#1a2e05")
            .attr("stroke", ACCENT).attr("stroke-width", 1 / zoomK);
          grp.append("text")
            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .attr("fill", ACCENT).attr("font-size", `${7 / zoomK}px`)
            .attr("font-family", FONT).attr("pointer-events", "none")
            .text(cl.coders.length);
          grp
            .on("mouseenter", () => {
              clCircle.transition().duration(150)
                .attr("fill", "#2a4a0a")
                .attr("stroke", "#ffffff")
                .attr("r", 14 / currentZoomKRef.current);
            })
            .on("mouseleave", () => {
              clCircle.transition().duration(150)
                .attr("fill", "#1a2e05")
                .attr("stroke", ACCENT)
                .attr("r", 10 / currentZoomKRef.current);
            })
            .on("click", (event) => {
              event.stopPropagation();
              const city = cl.coders[0].city;
              const uniqueCities = [...new Set(cl.coders.map((c) => c.city))];
              const label = uniqueCities.join(", ");
              setModal({ mode: "country", countryName: label, coders: cl.coders });
            });
        } else {
          const d = cl.coders[0];
          const circle = mg.append("circle").attr("class", "marker")
            .attr("cx", px).attr("cy", py)
            .attr("r", 0).attr("fill", MARKER_FILL).attr("stroke", "none")
            .style("cursor", "pointer");

          circle.transition().duration(300).ease(d3.easeBounceOut)
            .attr("r", 5 / zoomK);

          circle
            .on("mouseenter", (event) => {
              const cur = +d3.select(event.currentTarget).attr("r");
              d3.select(event.currentTarget)
                .attr("data-hover", "1")
                .transition().duration(150)
                .attr("fill", MARKER_HOVER)
                .attr("r", cur * 1.6);
            })
            .on("mouseleave", (event) => {
              d3.select(event.currentTarget)
                .attr("data-hover", null)
                .transition().duration(150)
                .attr("fill", MARKER_FILL)
                .attr("r", 5 / currentZoomKRef.current);
            })
            .on("click", (event) => { event.stopPropagation(); setModal(d); });
        }
      });
    });
  }, []);

  // Статус-пузыри в SVG
  useEffect(() => {
    const eligible = allCoders.filter((c) => c.status);
    if (!eligible.length) return;

    let idx = Math.floor(Math.random() * eligible.length);

    const showBubble = () => {
      const g = gRef.current;
      const projection = projectionRef.current;
      if (!g || !projection || !g.node()) return;

      const coder = eligible[idx % eligible.length];
      idx++;

      const [px, py] = projection(coder.coordinates);
      const zoomK = currentZoomKRef.current;
      const name = coder.name.split(" ")[0];
      const text = `${name}: ${coder.status}`;
      const fontSize = 9 / zoomK;
      const pad = 8 / zoomK;
      const bh = 18 / zoomK;
      // Примерная ширина текста
      const bw = text.length * (fontSize * 0.62) + pad * 2;
      const bx = px + 8 / zoomK;
      const by = py - bh - 8 / zoomK;

      const grp = d3.select(gRef.current.node()).append("g").attr("class", "status-bubble");

      grp.append("rect")
        .attr("x", bx).attr("y", by)
        .attr("width", bw).attr("height", bh)
        .attr("rx", 3 / zoomK)
        .attr("fill", "#0d0d0d")
        .attr("stroke", "#96ea28")
        .attr("stroke-width", 0.8 / zoomK)
        .attr("opacity", 0)
        .transition().duration(200).attr("opacity", 1);

      grp.append("text")
        .attr("x", bx + pad).attr("y", by + bh / 2)
        .attr("dominant-baseline", "middle")
        .attr("fill", "#fff")
        .attr("font-size", `${fontSize}px`)
        .attr("font-family", FONT)
        .attr("pointer-events", "none")
        .attr("opacity", 0)
        .text(text)
        .transition().duration(200).attr("opacity", 1);

      grp.append("line")
        .attr("x1", px).attr("y1", py - 5 / zoomK)
        .attr("x2", bx + 4 / zoomK).attr("y2", by + bh)
        .attr("stroke", "#96ea28")
        .attr("stroke-width", 0.8 / zoomK)
        .attr("opacity", 0)
        .transition().duration(200).attr("opacity", 0.5);

      setTimeout(() => {
        grp.selectAll("*")
          .transition().duration(300).attr("opacity", 0);
        grp.transition().delay(300).remove();
      }, 3000);
    };

    const schedule = () => {
      showBubble();
      statusIntervalRef.current = setTimeout(schedule, 3500 + Math.random() * 1500);
    };

    // TODO: fix status bubbles
    // statusIntervalRef.current = setTimeout(schedule, 1500);
    return () => clearTimeout(statusIntervalRef.current);
  }, [allCoders]);  useEffect(() => {
    if (!mapReadyRef.current) return;
    drawMarkers(getVisible(allCoders, activeSpecs), currentZoomKRef.current);
  }, [allCoders, activeSpecs, drawMarkers]);

  // Zen пульсация
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    if (zenMode) {
      g.selectAll(".marker").classed("zen-marker", true);
    } else {
      g.selectAll(".marker").classed("zen-marker", false);
    }
  }, [zenMode]);

  // Поиск
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    setSearchResults(
      allCodersRef.current.filter(
        (c) => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
      ).slice(0, 8)
    );
  }, [searchQuery]);

  const flyTo = (coder) => {
    setSearchQuery(""); setSearchResults([]); setSearchOpen(false);

    if (showGlobe) {
      // Вращаем глобус к нужной точке
      const proj = globeProjectionRef.current;
      const redraw = globeRedrawRef.current;
      if (!proj || !redraw) return;
      const [lon, lat] = coder.coordinates;
      const r = proj.rotate();
      const targetRotate = [-lon, -lat, r[2]];
      // Плавная анимация через интерполяцию
      const i = d3.interpolate(proj.rotate(), targetRotate);
      d3.transition().duration(800).tween("rotate", () => (t) => {
        proj.rotate(i(t));
        redraw();
      });
      return;
    }

    const svg = d3.select(svgNodeRef.current);
    const projection = projectionRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    const [px, py] = projection(coder.coordinates);
    const k = 4;
    svg.transition().duration(800).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W / 2 - px * k, H / 2 - py * k).scale(k)
    );
  };

  // Загрузка данных + realtime
  useEffect(() => {

    const applyData = (raw) => {
      const normalized = raw.map((c) => ({
        id: c.id, name: c.name, city: c.city,
        location: `${c.city}, ${c.country}`, countryId: c.country_id ?? null,
        coordinates: [c.lng, c.lat],
        github:    c.github?.trim()    || null,
        telegram:  c.telegram?.trim()  || null,
        linkedin:  c.linkedin?.trim()  || null,
        instagram: c.instagram?.trim() || null,
        website:   c.website?.trim()   || null,
        specialization: c.specialization || "", company: c.company || "",
        status: c.status?.trim() || null,
      }));
      allCodersRef.current = normalized;
      rebuildCodersByCountry(normalized);
      setAllCoders(normalized);
      updateSpecs(normalized);
      setLoading(false);
    };

    if (useMock) {
      fetch("/mock-coders.json").then((r) => r.json()).then(applyData);
      return;
    }

    supabase.from("coders").select("*").then(({ data, error }) => {
      if (error) { console.error(error); setLoading(false); return; }
      if (data?.length) applyData(data);
      else setLoading(false);
    });

    // Realtime — новые записи появляются у всех
    const channel = supabase.channel("coders-inserts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "coders" }, (payload) => {
        const newCoder = normalize(payload.new);
        setAllCoders((prev) => {
          const already = prev.some((c) => c.id === newCoder.id);
          if (already) return prev;
          const updated = [...prev, newCoder];
          allCodersRef.current = updated;
          rebuildCodersByCountry(updated);
          updateSpecs(updated);
          return updated;
        });
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Карта
  useEffect(() => {
    const width = window.innerWidth, height = window.innerHeight;
    const svg = d3.select(svgRef.current).attr("width", width).attr("height", height);
    svgNodeRef.current = svgRef.current;
    svg.selectAll("*").remove();

    const scale = width / 6.5;
    const mapWidth = scale * 2 * Math.PI;
    mapWidthRef.current = mapWidth;

    const projection = d3.geoMercator().scale(scale).translate([width / 2, height / 2]);
    projectionRef.current = projection;
    const path = d3.geoPath().projection(projection);

    const isMobile = width < 768;
    const labelSize = isMobile ? 3 : 4;

    const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", (event) => {
      const t = event.transform;
      const prevK = currentZoomKRef.current;
      currentZoomKRef.current = t.k;
      const scaledMapWidth = mapWidth * t.k;
      let tx = t.x % scaledMapWidth;
      if (tx > 0) tx -= scaledMapWidth;
      g.attr("transform", `translate(${tx},${t.y}) scale(${t.k})`);

      // Текст растёт медленнее карты — делим на sqrt(t.k) вместо t.k
      // При зуме 4x: без компенсации текст x4, с sqrt — только x2
      const textScale = Math.sqrt(t.k);
      g.selectAll(".country-label").attr("font-size", `${labelSize / textScale}px`);
      g.selectAll(".city-label").attr("font-size", `${labelSize / textScale}px`);

      // При пане — только масштабируем размеры, без перерисовки
      g.selectAll(".marker").attr("r", 5 / t.k);
      g.selectAll(".cluster circle").attr("r", 10 / t.k).attr("stroke-width", 1 / t.k);
      g.selectAll(".cluster text").attr("font-size", `${7 / t.k}px`);

      // Перекластеризуем только при значительном изменении зума
      if (Math.abs(t.k - prevK) > 0.4) {
        drawMarkers(getVisible(allCodersRef.current, activeSpecRef.current), t.k);
      }
    });
    zoomRef.current = zoom;
    svg.call(zoom);

    const g = svg.append("g");
    gRef.current = g;

    g.append("rect")
      .attr("width", width * 10).attr("height", height * 4)
      .attr("x", -width * 4).attr("y", -height).attr("fill", BG);

    d3.json("/world-110m.json").then((world) => {
      const countries = topojson.feature(world, world.objects.countries);
      const filteredCountries = countries.features.filter(
        (d) => d.id !== "010"
      );
      filteredCountriesRef.current = filteredCountries;

      d3.json("/country-names.json").then((names) => {
        const nameMap = {};
        names.forEach((n) => { nameMap[String(parseInt(n["country-code"]))] = n.name; });

        [-1, 0, 1].forEach((offset) => {
          const tileG = g.append("g").attr("transform", `translate(${offset * mapWidth}, 0)`);
          tileG.selectAll(".country").data(filteredCountries).enter().append("path")
            .attr("class", "country").attr("d", path)
            .attr("fill", COUNTRY_FILL).attr("stroke", COUNTRY_STROKE).attr("stroke-width", isMobile ? 0.3 : 0.5)
            .on("mouseover", function (event, d) {
              if (!codersByCountryRef.current[String(parseInt(d.id))]) return;
              d3.select(this).transition().duration(150).attr("fill", "#333333");
            })
            .on("mouseout", function () {
              d3.select(this).transition().duration(300).attr("fill", COUNTRY_FILL);
            })
            .on("click", (event, d) => {
              const list = codersByCountryRef.current[String(parseInt(d.id))];
              if (!list) return;
              setModal({ mode: "country", countryName: nameMap[String(parseInt(d.id))] || "Unknown", coders: list });
            })
            .style("cursor", (d) =>
              codersByCountryRef.current[String(parseInt(d.id))] ? "pointer" : "default"
            );

        // Для стран с несколькими полигонами берём centroid самого большого
        const getLabelPoint = (d) => {
          if (d.geometry.type === "MultiPolygon") {
            const largest = d.geometry.coordinates.reduce((a, b) =>
              d3.geoArea({ type: "Polygon", coordinates: a }) >
              d3.geoArea({ type: "Polygon", coordinates: b }) ? a : b
            );
            return path.centroid({ type: "Feature", geometry: { type: "Polygon", coordinates: largest } });
          }
          return path.centroid(d);
        };

          tileG.selectAll(".country-label")
            .data(filteredCountries.filter((d) => d3.geoArea(d) > 0.004)).enter()
            .append("text").attr("class", "country-label")
            .attr("x", (d) => getLabelPoint(d)[0]).attr("y", (d) => getLabelPoint(d)[1])
            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .attr("fill", "#555555").attr("font-size", `${labelSize}px`).attr("font-family", FONT)
            .attr("pointer-events", "none").attr("letter-spacing", "0.3px")
            .text((d) => nameMap[String(parseInt(d.id))] || "");
        });

        mapReadyRef.current = true;
        if (allCodersRef.current.length) drawMarkers(allCodersRef.current, 1);
      });
    });

    const handleResize = () => svg.attr("width", window.innerWidth).attr("height", window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawMarkers]);

  const handleSpecClick = (spec) => {
    setActiveSpecs((prev) => {
      const next = new Set(prev);
      next.has(spec) ? next.delete(spec) : next.add(spec);
      activeSpecRef.current = next;
      return next;
    });
  };

  const handleRegister = async (form) => {
    let newCoder;

    if (useMock) {
      newCoder = {
        id: `mock-${Date.now()}`, name: form.name, city: form.city,
        country: form.country, specialization: form.specialization,
        company: form.company, github: form.github,
        telegram: form.telegram, linkedin: form.linkedin,
        instagram: form.instagram, website: form.website,
        lat: form.lat, lng: form.lng,
      };
    } else {
      const { data, error } = await supabase.from("coders").insert([{
        name: form.name, city: form.city, country: form.country,
        specialization: form.specialization, company: form.company,
        github: form.github, telegram: form.telegram,
        linkedin: form.linkedin, instagram: form.instagram, website: form.website,
        lat: form.lat, lng: form.lng, country_id: null,
      }]).select().single();
      if (error) { console.error(error); return; }
      newCoder = data;
    }

    const normalized = normalize({ ...newCoder, country_id: null });
    setAllCoders((prev) => {
      const updated = [...prev, normalized];
      allCodersRef.current = updated;
      rebuildCodersByCountry(updated);
      updateSpecs(updated);
      return updated;
    });
    setToast(`→ ${newCoder.name} added to the map.\n  location: ${newCoder.city}, ${newCoder.country}`);

    // Летим к новому маркеру
    flyTo(normalized);
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: BG }}>
      <style>{`
        .spec-btn {
          position: relative;
          overflow: hidden;
          transition: border-color 0.15s;
        }
        .spec-btn::before {
          content: "";
          position: absolute;
          inset: 0;
          background: #96ea28;
          opacity: 0;
          transition: opacity 0.15s ease;
          z-index: 0;
        }
        .spec-btn:hover::before {
          opacity: 1;
        }
        .spec-btn span {
          position: relative;
          z-index: 1;
          transition: color 0.15s;
        }
        .spec-btn:hover span {
          color: #000 !important;
        }
        .spec-btn.active::before {
          opacity: 1;
        }
        .spec-btn.active span {
          color: #000 !important;
        }
        @keyframes zenPulse {
          0%, 100% { opacity: 1; r: 5px; }
          50% { opacity: 0.4; r: 7px; }
        }
        .zen-marker {
          animation: zenPulse 3s ease-in-out infinite;
        }
        .zen-cluster circle {
          animation: zenPulse 3s ease-in-out infinite;
        }
      `}</style>
      <svg ref={svgRef} style={{ display: showGlobe ? "none" : "block" }} />
      {showGlobe && (
        <GlobeMap
          coders={allCoders}
          activeSpecs={activeSpecs}
          onMarkerClick={(d) => setModal(d)}
          onReady={(proj, redraw) => {
            globeProjectionRef.current = proj;
            globeRedrawRef.current = redraw;
          }}
        />
      )}

      {/* Лоадер */}
      {loading && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", background: BG, zIndex: 50, fontFamily: FONT,
        }}>
          <div style={{ fontSize: 12, color: ACCENT }}>loading map data_</div>
        </div>
      )}

      {/* Левая панель */}
      {!zenMode && <div style={{ position: "absolute", top: isMobile ? 14 : 28, left: isMobile ? 14 : 36, fontFamily: FONT }}>
        <div style={{ fontSize: isMobile ? 9 : 11, color: ACCENT, marginBottom: 4, pointerEvents: "none", userSelect: "none" }}>
          root@yakutia:~$ ./map --show coders
        </div>
        <div style={{ fontSize: isMobile ? 13 : "clamp(14px, 2vw, 22px)", fontWeight: 700, color: TEXT_BRIGHT, letterSpacing: "0.01em", pointerEvents: "none", userSelect: "none" }}>
          карта разработчиков из Якутии
        </div>
        <div style={{ fontSize: isMobile ? 9 : 11, color: TEXT_DIM, marginTop: 4, pointerEvents: "none", userSelect: "none" }}>
          <span style={{color: ACCENT}}>{allCoders.length}</span> developers found_
        </div>
        <a href="/about" style={{
          display: "block", marginTop: 6, fontSize: isMobile ? 9 : 11, color: TEXT_DIM,
          textDecoration: "none", letterSpacing: "0.05em",
        }}>
          about ↗
        </a>
        <button onClick={toggleMock} style={{
          marginTop: 6, display: "block", background: "none", border: "none",
          padding: 0, color: useMock ? ACCENT : "#333",
          fontFamily: FONT, fontSize: isMobile ? 9 : 11,
          cursor: "pointer", letterSpacing: "0.05em", textAlign: "left",
        }}>
          {useMock ? "● mock data on" : "○ mock data off"}
        </button>
        <button onClick={toggleGlobe} style={{
          marginTop: 6, display: "block", background: "none", border: "none",
          padding: 0, color: showGlobe ? ACCENT : "#333",
          fontFamily: FONT, fontSize: isMobile ? 9 : 11,
          cursor: "pointer", letterSpacing: "0.05em", textAlign: "left",
        }}>
          {showGlobe ? "● globe" : "○ globe"}
        </button>        <button onClick={() => setShowRegister(true)} style={{
          marginTop: isMobile ? 8 : 14, display: "block", background: "none",
          border: `1px solid ${ACCENT}`, borderRadius: 4,
          padding: isMobile ? "5px 10px" : "7px 16px",
          color: ACCENT, fontFamily: FONT, fontSize: isMobile ? 10 : 11,
          cursor: "pointer", letterSpacing: "0.05em",
        }}>
          → отметиться на карте
        </button>
      </div>}

      {/* Верхняя центральная панель */}
      {!zenMode && <div style={{
        position: "absolute", top: isMobile ? 14 : 28, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: isMobile ? 12 : 20,
        fontFamily: FONT, fontSize: isMobile ? 10 : 11, zIndex: 10,
      }}>
        <a href="/about" style={{ color: TEXT_DIM, textDecoration: "none", letterSpacing: "0.05em" }}>
          about ↗
        </a>
        <button onClick={toggleMock} style={{
          background: "none", border: "none", padding: 0,
          color: useMock ? ACCENT : "#444",
          fontFamily: FONT, fontSize: "inherit", cursor: "pointer", letterSpacing: "0.05em",
        }}>
          {useMock ? "● mock" : "○ mock"}
        </button>
        <button onClick={toggleGlobe} style={{
          background: "none", border: "none", padding: 0,
          color: showGlobe ? ACCENT : "#444",
          fontFamily: FONT, fontSize: "inherit", cursor: "pointer", letterSpacing: "0.05em",
        }}>
          {showGlobe ? "● globe" : "○ globe"}
        </button>
        <button onClick={() => setZenMode((v) => !v)} style={{
          background: "none", border: "none", padding: 0,
          color: zenMode ? ACCENT : "#444",
          fontFamily: FONT, fontSize: "inherit", cursor: "pointer", letterSpacing: "0.05em",
        }}>
          {zenMode ? "● zen" : "○ zen"}
        </button>
      </div>}

      {/* Поиск */}
      {!zenMode && <div style={{
        position: "absolute",
        ...(isMobile
          ? { bottom: 60, left: "50%", transform: "translateX(-50%)", width: "80vw" }
          : { top: 28, right: 36, width: "clamp(180px, 25vw, 260px)" }
        ),
        fontFamily: FONT,
      }}>
        <div style={{ position: "relative" }}>
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="поиск по имени или городу_"
            style={{
              width: "100%", background: "#0d0d0d", border: "1px solid #222",
              borderRadius: 4, padding: "7px 10px", color: "#fff",
              fontFamily: FONT, fontSize: 11, outline: "none",
            }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
              background: "#0d0d0d", border: "1px solid #222", borderRadius: 4, marginTop: 2,
            }}>
              {searchResults.map((c) => (
                <div key={c.id} onMouseDown={() => flyTo(c)} style={{
                  padding: "8px 10px", fontSize: 11, color: "#888",
                  cursor: "pointer", borderBottom: "1px solid #1a1a1a",
                }}
                  onMouseEnter={(e) => e.currentTarget.style.color = ACCENT}
                  onMouseLeave={(e) => e.currentTarget.style.color = "#888"}
                >
                  <span style={{ color: "#fff" }}>{c.name}</span>
                  <span style={{ marginLeft: 8, color: "#444" }}>→ {c.city}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>}

      {/* Фильтр по специализации */}
      {!zenMode && <div style={{
        position: "absolute", bottom: isMobile ? 110 : 28, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: isMobile ? 4 : 6, flexWrap: "wrap", justifyContent: "center",
        fontFamily: FONT, maxWidth: "90vw",
      }}>
        {specs.map((spec) => (
          <button
            key={spec}
            onClick={() => handleSpecClick(spec)}
            className={`spec-btn${activeSpecs.has(spec) ? " active" : ""}`}
            style={{
              background: "none",
              border: `1px solid ${activeSpecs.has(spec) ? ACCENT : "#333"}`,
              borderRadius: 4, padding: isMobile ? "3px 7px" : "4px 10px",
              color: activeSpecs.has(spec) ? "#000" : "#555",
              fontFamily: FONT, fontSize: isMobile ? 9 : 10, cursor: "pointer",
            }}
          >
            <span style={{ color: "inherit" }}>{spec}</span>
          </button>
        ))}
      </div>}

      {/* Zen выход — ESC или кнопка */}
      {zenMode && (
        <button onClick={() => setZenMode(false)} style={{
          position: "absolute", top: 16, right: 16,
          background: "none", border: "none", padding: 0,
          color: "#333", fontFamily: FONT, fontSize: 11,
          cursor: "pointer", letterSpacing: "0.05em", zIndex: 10,
        }}>
          ○ zen
        </button>
      )}
      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSubmit={handleRegister}
          existingCoders={allCoders}
          isMockMode={useMock}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <CookieBanner />
    </div>
  );
}
