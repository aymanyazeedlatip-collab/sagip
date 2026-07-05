const SAGIP_REPORT_VERSION = "SAGIP Reports v1.0";
let latestSagipReportHtml = "";
let latestSagipReportData = null;

function initializeSagipReports() {
    refreshReportsReadiness();
    renderReportEmptyPreview();

    const reportType = document.getElementById("report-type-select");
    if (reportType) reportType.addEventListener("change", applyReportTypePreset);

    document.querySelectorAll(".report-option-checkbox").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
            if (latestSagipReportData) generateSagipReportPreview();
        });
    });

    document.querySelectorAll(".nav-btn").forEach((button) => {
        button.addEventListener("click", () => {
            if (button.dataset.tab === "reports") {
                setTimeout(() => {
                    refreshReportsReadiness();
                    if (latestSagipReportHtml) renderReportPreview(latestSagipReportHtml);
                }, 250);
            }
        });
    });
}

function getSagipReportContext() {
    return {
        generatedAt: new Date(),
        terrainData: window.latestTerrainData || null,
        terrain: window.latestTerrainData?.terrain || null,
        rainfallForecast: window.latestRainfallForecast || null,
        floodSimulation: window.latestFloodSimulation || null,
        vulnerability: window.latestVulnerabilityAnalysis || null,
        waterBodies: window.latestWaterBodies || [],
        waterSummary: window.latestWaterSummary || null,
        floodSnapshot: window.latestFloodSnapshot || null,
    };
}

function getSagipReportReadiness(context = getSagipReportContext()) {
    const status = {
        terrain: Boolean(context.terrain),
        rainfall: Boolean(context.rainfallForecast),
        flood: Boolean(context.floodSimulation?.snapshots?.length),
        vulnerability: Boolean(context.vulnerability),
        water: Boolean(context.waterBodies?.length || context.waterSummary),
    };

    return {
        ...status,
        requiredReady: status.terrain && status.rainfall && status.flood,
        completeReady: status.terrain && status.rainfall && status.flood && status.vulnerability,
    };
}

function refreshReportsReadiness() {
    const context = getSagipReportContext();
    const readiness = getSagipReportReadiness(context);

    setReportReadyCard("report-ready-terrain", readiness.terrain, "Terrain Data");
    setReportReadyCard("report-ready-rainfall", readiness.rainfall, "Rainfall Forecast");
    setReportReadyCard("report-ready-flood", readiness.flood, "Flood Simulation");
    setReportReadyCard("report-ready-vulnerability", readiness.vulnerability, "Vulnerability Analysis");
    setReportReadyCard("report-ready-water", readiness.water, "Water Bodies");

    const status = document.getElementById("report-status-badge");
    if (status) {
        if (readiness.completeReady) {
            status.textContent = "Complete Report Ready";
            status.className = "report-status-badge ready";
        } else if (readiness.requiredReady) {
            status.textContent = "Basic Report Ready";
            status.className = "report-status-badge warning";
        } else {
            status.textContent = "Incomplete Data";
            status.className = "report-status-badge missing";
        }
    }

    renderReportQuickFindings(context, readiness);
}

function setReportReadyCard(id, ready, label) {
    const card = document.getElementById(id);
    if (!card) return;
    card.className = ready ? "report-ready-card ready" : "report-ready-card missing";
    card.innerHTML = `<span>${escapeReportHtml(label)}</span><strong>${ready ? "Ready" : "Missing"}</strong>`;
}

function renderReportQuickFindings(context, readiness) {
    const vulnerability = context.vulnerability;
    const flood = context.floodSimulation;
    const terrain = context.terrain;
    const vulnSummary = vulnerability?.summary || {};
    const floodSummary = flood?.summary || {};
    const terrainSummary = terrain?.summary || {};

    setReportText("report-finding-risk", vulnSummary.overall_level || floodSummary.overall_risk || "—");
    setReportText("report-finding-score", vulnSummary.overall_score != null ? `${Number(vulnSummary.overall_score).toFixed(1)}/100` : "—");
    setReportText("report-finding-depth", vulnSummary.peak_depth_cm != null ? `${Number(vulnSummary.peak_depth_cm).toFixed(1)} cm` : floodSummary.max_depth_cm != null ? `${Number(floodSummary.max_depth_cm).toFixed(1)} cm` : "—");
    setReportText("report-finding-impact", vulnSummary.earliest_impact_hour != null ? `Hour ${vulnSummary.earliest_impact_hour}` : "—");
    setReportText("report-finding-hotspot", vulnerability?.hotspots?.[0]?.id || "—");
    setReportText("report-finding-terrain", terrainSummary.terrain_type || "—");

    const warning = document.getElementById("report-readiness-warning");
    if (!warning) return;

    if (readiness.completeReady) {
        warning.innerHTML = `<strong>Ready:</strong> SAGIP has enough data to generate the full technical report, emergency report, and executive summary.`;
        warning.className = "report-readiness-warning ready";
    } else if (readiness.requiredReady) {
        warning.innerHTML = `<strong>Basic report available:</strong> vulnerability analysis is missing. Generate Vulnerability Alerts for the strongest final report.`;
        warning.className = "report-readiness-warning warning";
    } else {
        warning.innerHTML = `<strong>Missing data:</strong> run Full SAGIP Analysis first. Reports need at least terrain, rainfall forecast, and flood simulation.`;
        warning.className = "report-readiness-warning missing";
    }
}

function applyReportTypePreset() {
    const type = document.getElementById("report-type-select")?.value || "technical";
    const presets = {
        executive: { area: true, terrain: true, rainfall: true, water: false, flood: true, vulnerability: true, hotspots: true, safezones: false, timeline: false, methodology: false, limitations: true },
        technical: { area: true, terrain: true, rainfall: true, water: true, flood: true, vulnerability: true, hotspots: true, safezones: true, timeline: true, methodology: true, limitations: true },
        emergency: { area: true, terrain: false, rainfall: true, water: true, flood: true, vulnerability: true, hotspots: true, safezones: true, timeline: true, methodology: false, limitations: true },
    };
    const selected = presets[type] || presets.technical;
    Object.entries(selected).forEach(([key, value]) => {
        const checkbox = document.getElementById(`report-include-${key}`);
        if (checkbox) checkbox.checked = value;
    });
    if (latestSagipReportData) generateSagipReportPreview();
}

function getReportOptions() {
    return {
        type: document.getElementById("report-type-select")?.value || "technical",
        title: document.getElementById("report-title-input")?.value?.trim() || "SAGIP Flood Risk Assessment Report",
        preparedFor: document.getElementById("report-prepared-for-input")?.value?.trim() || "Local Flood Risk Review",
        preparedBy: document.getElementById("report-prepared-by-input")?.value?.trim() || "SAGIP System",
        include: {
            area: document.getElementById("report-include-area")?.checked !== false,
            terrain: document.getElementById("report-include-terrain")?.checked !== false,
            rainfall: document.getElementById("report-include-rainfall")?.checked !== false,
            water: document.getElementById("report-include-water")?.checked !== false,
            flood: document.getElementById("report-include-flood")?.checked !== false,
            vulnerability: document.getElementById("report-include-vulnerability")?.checked !== false,
            hotspots: document.getElementById("report-include-hotspots")?.checked !== false,
            safezones: document.getElementById("report-include-safezones")?.checked !== false,
            timeline: document.getElementById("report-include-timeline")?.checked !== false,
            methodology: document.getElementById("report-include-methodology")?.checked !== false,
            limitations: document.getElementById("report-include-limitations")?.checked !== false,
        },
    };
}

function generateSagipReportPreview() {
    const context = getSagipReportContext();
    const readiness = getSagipReportReadiness(context);
    refreshReportsReadiness();

    if (!readiness.requiredReady) {
        alert("Run Full SAGIP Analysis first. Reports need terrain, rainfall forecast, and flood simulation.");
        return;
    }

    const options = getReportOptions();
    const reportData = buildSagipReportData(context, readiness, options);
    const html = buildSagipReportHtml(reportData);
    latestSagipReportData = reportData;
    latestSagipReportHtml = html;
    renderReportPreview(html);
    setReportStatusMessage("Report preview generated successfully.", "success");
}

function buildSagipReportData(context, readiness, options) {
    const terrain = context.terrain;
    const terrainSummary = terrain?.summary || {};
    const vulnerability = context.vulnerability || null;
    const vulnSummary = vulnerability?.summary || {};
    const flood = context.floodSimulation;
    const floodSummary = flood?.summary || {};
    const forecast = context.rainfallForecast;
    const waterBodies = context.waterBodies || [];
    const waterSummary = context.waterSummary || null;
    const snapshots = flood?.snapshots || [];
    const hourlyForecast = forecast?.forecast?.hourly || [];
    const dailyForecast = forecast?.forecast?.daily || [];
    const peakDepth = vulnSummary.peak_depth_cm ?? floodSummary.max_depth_cm ?? getMaxFloodDepthFromSnapshots(snapshots);
    const earliestImpact = vulnSummary.earliest_impact_hour;
    const overallLevel = vulnSummary.overall_level || estimateReportRiskFromDepth(peakDepth);
    const overallScore = vulnSummary.overall_score;
    const executiveSummary = buildExecutiveReportSummary({ overallLevel, overallScore, peakDepth, earliestImpact, vulnerability });

    return {
        meta: {
            title: options.title,
            preparedFor: options.preparedFor,
            preparedBy: options.preparedBy,
            generatedAtText: context.generatedAt.toLocaleString(),
            reportType: options.type,
            version: SAGIP_REPORT_VERSION,
        },
        readiness,
        options,
        executiveSummary,
        terrain,
        terrainSummary,
        forecast,
        hourlyForecast,
        dailyForecast,
        flood,
        floodSummary,
        snapshots,
        vulnerability,
        vulnSummary,
        waterBodies,
        waterSummary,
        keyFindings: {
            overallLevel,
            overallScore,
            peakDepth,
            earliestImpact,
            hotspotCount: vulnerability?.hotspots?.length || 0,
            topHotspot: vulnerability?.hotspots?.[0] || null,
            criticalCells: vulnSummary.critical_cell_count,
            highCells: vulnSummary.high_cell_count,
            terrainType: terrainSummary.terrain_type,
            elevationRange: terrainSummary.elevation_range_m,
        },
    };
}

function buildExecutiveReportSummary(data) {
    const level = data.overallLevel || "undetermined";
    const scoreText = data.overallScore != null ? ` with a vulnerability score of ${Number(data.overallScore).toFixed(1)}/100` : "";
    const depthText = data.peakDepth != null ? ` Peak modeled flood depth reached ${Number(data.peakDepth).toFixed(1)} cm.` : "";
    const impactText = data.earliestImpact != null ? ` Earliest modeled flood impact begins around Hour ${data.earliestImpact}.` : "";
    const hotspotText = data.vulnerability?.hotspots?.length ? ` The highest-priority hotspot is ${data.vulnerability.hotspots[0].id}, classified as ${data.vulnerability.hotspots[0].risk_class}.` : " No ranked vulnerability hotspot was available or detected.";
    return `SAGIP generated a ${level} flood-vulnerability condition${scoreText} for the selected analysis area.${depthText}${impactText}${hotspotText} This report is intended for decision support, technical review, and field-validation planning.`;
}

function buildSagipReportHtml(report) {
    const include = report.options.include;
    const sections = [buildReportCoverSection(report), buildReportExecutiveSection(report)];
    if (include.area) sections.push(buildReportAreaSection(report));
    if (include.terrain) sections.push(buildReportTerrainSection(report));
    if (include.rainfall) sections.push(buildReportRainfallSection(report));
    if (include.water) sections.push(buildReportWaterSection(report));
    if (include.flood) sections.push(buildReportFloodSection(report));
    if (include.vulnerability) sections.push(buildReportVulnerabilitySection(report));
    if (include.hotspots) sections.push(buildReportHotspotsSection(report));
    if (include.safezones) sections.push(buildReportSafeZonesSection(report));
    if (include.timeline) sections.push(buildReportTimelineSection(report));
    if (include.methodology) sections.push(buildReportMethodologySection());
    if (include.limitations) sections.push(buildReportLimitationsSection());
    return `<article class="sagip-report-document">${sections.join("")}</article>`;
}

function buildReportCoverSection(report) {
    const findings = report.keyFindings;
    return `
        <section class="report-cover">
            <div class="report-cover-brand">SAGIP</div>
            <h1>${escapeReportHtml(report.meta.title)}</h1>
            <p class="report-subtitle">Spatial Analytics and Geospatial Inundation Projection for Flood Early Warning and Emergency Response</p>
            <div class="report-cover-grid">
                <div><span>Prepared For</span><strong>${escapeReportHtml(report.meta.preparedFor)}</strong></div>
                <div><span>Prepared By</span><strong>${escapeReportHtml(report.meta.preparedBy)}</strong></div>
                <div><span>Generated</span><strong>${escapeReportHtml(report.meta.generatedAtText)}</strong></div>
                <div><span>Report Type</span><strong>${escapeReportHtml(capitalizeReportText(report.meta.reportType))}</strong></div>
                <div><span>System Version</span><strong>${escapeReportHtml(report.meta.version)}</strong></div>
                <div><span>Report Status</span><strong>${report.readiness.completeReady ? "Complete" : "Basic"}</strong></div>
            </div>
            <div class="report-alert-strip level-${String(findings.overallLevel || "minimal").toLowerCase()}">
                <span>Overall Alert Level</span><strong>${escapeReportHtml(findings.overallLevel || "—")}</strong>
            </div>
        </section>`;
}

function buildReportExecutiveSection(report) {
    const f = report.keyFindings;
    return `
        <section class="report-section">
            <h2>1. Executive Summary</h2>
            <p>${escapeReportHtml(report.executiveSummary)}</p>
            <div class="report-kpi-grid">
                ${reportKpi("Overall Level", f.overallLevel || "—")}
                ${reportKpi("Vulnerability Score", f.overallScore != null ? `${Number(f.overallScore).toFixed(1)}/100` : "—")}
                ${reportKpi("Peak Flood Depth", f.peakDepth != null ? `${Number(f.peakDepth).toFixed(1)} cm` : "—")}
                ${reportKpi("Earliest Impact", f.earliestImpact != null ? `Hour ${f.earliestImpact}` : "—")}
                ${reportKpi("Critical Cells", f.criticalCells ?? "—")}
                ${reportKpi("Priority Hotspots", f.hotspotCount ?? "—")}
            </div>
        </section>`;
}

function buildReportAreaSection(report) {
    const terrain = report.terrain || {};
    const bounds = getReportBoundsFromTerrain(terrain);
    return `<section class="report-section"><h2>2. Selected Area Information</h2><table class="report-table"><tbody>
        ${reportTableRow("North Bound", bounds ? bounds.north.toFixed(6) : "—")}
        ${reportTableRow("South Bound", bounds ? bounds.south.toFixed(6) : "—")}
        ${reportTableRow("East Bound", bounds ? bounds.east.toFixed(6) : "—")}
        ${reportTableRow("West Bound", bounds ? bounds.west.toFixed(6) : "—")}
        ${reportTableRow("DEM Resolution", terrain?.resolution ? `${terrain.resolution} × ${terrain.resolution}` : "—")}
        ${reportTableRow("DEM Source", terrain?.source || "—")}
    </tbody></table></section>`;
}

function buildReportTerrainSection(report) {
    const s = report.terrainSummary || {};
    return `<section class="report-section"><h2>3. Terrain and DEM Analysis</h2><p>The terrain module analyzes elevation distribution and low-lying terrain conditions inside the selected rectangle.</p><table class="report-table"><tbody>
        ${reportTableRow("Minimum Elevation", formatNumber(s.min_elevation_m, " m"))}
        ${reportTableRow("Maximum Elevation", formatNumber(s.max_elevation_m, " m"))}
        ${reportTableRow("Elevation Range", formatNumber(s.elevation_range_m, " m"))}
        ${reportTableRow("Mean Elevation", formatNumber(s.mean_elevation_m, " m"))}
        ${reportTableRow("Terrain Type", s.terrain_type || "—")}
        ${reportTableRow("Low Point Count", s.low_point_count ?? "—")}
    </tbody></table></section>`;
}

function buildReportRainfallSection(report) {
    const hourly = report.hourlyForecast || [];
    const daily = report.dailyForecast || [];
    const totalRain = hourly.reduce((sum, item) => sum + Number(item.precipitation_mm ?? item.rain_mm ?? 0), 0);
    const maxHourly = hourly.reduce((max, item) => Math.max(max, Number(item.precipitation_mm ?? item.rain_mm ?? 0)), 0);
    const rows = daily.slice(0, 10).map((day, index) => `<tr><td>${escapeReportHtml(day.date || `Day ${index + 1}`)}</td><td>${formatNumber(day.precipitation_sum_mm ?? day.precipitation_mm ?? day.rain_sum_mm, " mm")}</td><td>${formatNumber(day.precipitation_probability_max ?? day.rain_probability_max, "%")}</td><td>${formatNumber(day.wind_speed_max_kmh ?? day.wind_speed_10m_max, " km/h")}</td></tr>`).join("");
    return `<section class="report-section"><h2>4. Rainfall Forecast Summary</h2><div class="report-kpi-grid">${reportKpi("Hourly Records", hourly.length)}${reportKpi("Daily Records", daily.length)}${reportKpi("Total Hourly Rainfall", `${totalRain.toFixed(1)} mm`)}${reportKpi("Max Hourly Rainfall", `${maxHourly.toFixed(1)} mm/hr`)}</div><table class="report-table"><thead><tr><th>Date</th><th>Rainfall</th><th>Probability</th><th>Wind</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No daily rainfall table available.</td></tr>`}</tbody></table></section>`;
}

function buildReportWaterSection(report) {
    const bodies = report.waterBodies || [];
    const summary = report.waterSummary || {};
    const rows = bodies.slice(0, 12).map((item, index) => `<tr><td>${index + 1}</td><td>${escapeReportHtml(item.name || "Unnamed")}</td><td>${escapeReportHtml(item.category || "Water Feature")}</td><td>${formatNumber((item.overflow_importance || 0) * 100, "%")}</td><td>${item.estimated_width_m || "—"}</td></tr>`).join("");
    return `<section class="report-section"><h2>5. Water Body and Drainage Context</h2><div class="report-kpi-grid">${reportKpi("Detected Features", bodies.length)}${reportKpi("Rivers", summary.river_count ?? "—")}${reportKpi("Streams", summary.stream_count ?? "—")}${reportKpi("Drainage / Canals", summary.drainage_count ?? "—")}</div><table class="report-table"><thead><tr><th>#</th><th>Name</th><th>Category</th><th>Overflow Proxy</th><th>Est. Width</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No mapped water bodies were detected or loaded.</td></tr>`}</tbody></table></section>`;
}

function buildReportFloodSection(report) {
    const snapshots = report.snapshots || [];
    const peak = report.keyFindings.peakDepth;
    return `<section class="report-section"><h2>6. Flood Simulation Results</h2><p>The flood simulation estimates rainfall-driven water accumulation over the DEM grid and records flood snapshots across time.</p><div class="report-kpi-grid">${reportKpi("Simulation Snapshots", snapshots.length)}${reportKpi("Peak Depth", peak != null ? `${Number(peak).toFixed(1)} cm` : "—")}${reportKpi("Max Flooded Cells", getMaxFloodedCells(snapshots))}${reportKpi("Final Snapshot Hour", snapshots.length ? `Hour ${snapshots[snapshots.length - 1].hour_index ?? "—"}` : "—")}</div></section>`;
}

function buildReportVulnerabilitySection(report) {
    const vulnerability = report.vulnerability;
    const s = report.vulnSummary || {};
    if (!vulnerability) return `<section class="report-section"><h2>7. Vulnerability Assessment</h2><p>No vulnerability analysis was available when this report was generated.</p></section>`;
    return `<section class="report-section"><h2>7. Vulnerability Assessment</h2><p>${escapeReportHtml(vulnerability.intelligence_summary || "No vulnerability intelligence summary available.")}</p><table class="report-table"><tbody>${reportTableRow("Overall Level", s.overall_level || "—")}${reportTableRow("Overall Score", s.overall_score != null ? `${Number(s.overall_score).toFixed(1)}/100` : "—")}${reportTableRow("Critical Cells", s.critical_cell_count ?? "—")}${reportTableRow("High Cells", s.high_cell_count ?? "—")}${reportTableRow("Moderate Cells", s.moderate_cell_count ?? "—")}${reportTableRow("Vulnerable Cells", s.vulnerable_cell_count ?? "—")}</tbody></table>${buildRecommendationsBlock(vulnerability.recommendations || [])}</section>`;
}

function buildReportHotspotsSection(report) {
    const hotspots = report.vulnerability?.hotspots || [];
    const rows = hotspots.map((h) => `<tr><td>${h.rank}</td><td>${escapeReportHtml(h.id)}</td><td>${escapeReportHtml(h.risk_class)}</td><td>${formatNumber(h.score, "/100")}</td><td>${formatNumber(h.max_depth_cm, " cm")}</td><td>${h.first_impact_hour == null ? "—" : `Hour ${h.first_impact_hour}`}</td><td>${formatNumber(h.average_duration_hours, " hr")}</td><td>${formatNumber(h.estimated_area_km2, " km²")}</td></tr>`).join("");
    return `<section class="report-section"><h2>8. Priority Vulnerability Hotspots</h2><table class="report-table"><thead><tr><th>Rank</th><th>ID</th><th>Risk</th><th>Score</th><th>Peak Depth</th><th>First Impact</th><th>Duration</th><th>Area</th></tr></thead><tbody>${rows || `<tr><td colspan="8">No priority hotspots were available.</td></tr>`}</tbody></table></section>`;
}

function buildReportSafeZonesSection(report) {
    const zones = report.vulnerability?.safe_zones || [];
    const rows = zones.map((z) => `<tr><td>${z.rank}</td><td>${escapeReportHtml(z.id)}</td><td>${formatNumber(z.average_elevation_m, " m")}</td><td>${formatNumber(z.estimated_area_km2, " km²")}</td><td>${formatNumber(z.average_vulnerability_score, "/100")}</td><td>${escapeReportHtml(z.note || "Verify field access.")}</td></tr>`).join("");
    return `<section class="report-section"><h2>9. Potential High-Ground Candidates</h2><table class="report-table"><thead><tr><th>Rank</th><th>ID</th><th>Avg. Elevation</th><th>Area</th><th>Avg. Risk</th><th>Note</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No high-ground candidates were available.</td></tr>`}</tbody></table></section>`;
}

function buildReportTimelineSection(report) {
    const snapshots = report.snapshots || [];
    const rows = snapshots.slice(0, 28).map((s) => `<tr><td>Hour ${s.hour_index ?? "—"}</td><td>${formatNumber(s.rainfall_mm, " mm")}</td><td>${s.flooded_cell_count ?? "—"}</td><td>${formatNumber(s.max_depth_cm, " cm")}</td><td>${s.high_or_severe_cell_count ?? "—"}</td></tr>`).join("");
    return `<section class="report-section"><h2>10. Flood Timeline Appendix</h2><table class="report-table"><thead><tr><th>Time</th><th>Rainfall</th><th>Flooded Cells</th><th>Max Depth</th><th>High/Severe Cells</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No simulation timeline available.</td></tr>`}</tbody></table></section>`;
}

function buildReportMethodologySection() {
    return `<section class="report-section"><h2>11. Technical Methodology</h2><ul class="report-method-list"><li><strong>Terrain Analysis:</strong> DEM values generate an elevation grid, low-point detection, and terrain classification.</li><li><strong>Rainfall Forecast:</strong> Forecast rainfall is used as time-varying input for the flood simulation.</li><li><strong>Flood Simulation:</strong> The system applies a simplified DEM-based rainfall accumulation, runoff, drainage, and terrain-flow model.</li><li><strong>Vulnerability Scoring:</strong> Vulnerability combines peak flood depth, duration, time-to-impact, low relative elevation, basin behavior, and water-body proximity.</li><li><strong>Hotspot Detection:</strong> High-scoring vulnerable cells are clustered into priority zones.</li><li><strong>Safe-Zone Candidates:</strong> Potential high-ground cells are detected based on low modeled flood exposure and higher relative elevation.</li></ul></section>`;
}

function buildReportLimitationsSection() {
    return `<section class="report-section report-limitations"><h2>12. Limitations and Responsible Use</h2><p>This report is generated for decision support and research demonstration only. It is not an official evacuation order, engineering certification, or replacement for local government disaster-risk assessment.</p><ul><li>Flood results depend on DEM resolution, forecast quality, and model assumptions.</li><li>Mapped water-body completeness may vary depending on available OpenStreetMap data.</li><li>Real flood behavior may be affected by drainage structures, soil saturation, land cover, obstruction, tides, and infrastructure not included in the simplified model.</li><li>All high-risk areas, hotspot zones, and potential high-ground candidates require field validation.</li></ul></section>`;
}

function buildRecommendationsBlock(recommendations) {
    if (!recommendations.length) return "";
    return `<div class="report-recommendations-block"><h3>Recommended Actions</h3>${recommendations.map((item) => `<div class="report-recommendation-item"><span>${escapeReportHtml(item.level || "Advisory")}</span><strong>${escapeReportHtml(item.title || "Recommended Action")}</strong><p>${escapeReportHtml(item.details || "")}</p></div>`).join("")}</div>`;
}

function reportKpi(label, value) { return `<div class="report-kpi"><span>${escapeReportHtml(label)}</span><strong>${escapeReportHtml(value)}</strong></div>`; }
function reportTableRow(label, value) { return `<tr><td>${escapeReportHtml(label)}</td><td><strong>${escapeReportHtml(value)}</strong></td></tr>`; }
function renderReportPreview(html) { const preview = document.getElementById("report-preview"); if (preview) preview.innerHTML = html; }
function renderReportEmptyPreview() { const preview = document.getElementById("report-preview"); if (preview) preview.innerHTML = `<div class="report-empty-preview"><h3>No report generated yet</h3><p>Run Full SAGIP Analysis, then click Generate Report Preview.</p></div>`; }

function printSagipReport() {
    if (!latestSagipReportHtml) generateSagipReportPreview();
    setTimeout(() => window.print(), 200);
}

function downloadSagipReportHtml() {
    if (!latestSagipReportHtml) generateSagipReportPreview();
    if (!latestSagipReportHtml) return;
    const title = latestSagipReportData?.meta?.title || "SAGIP Report";
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeReportHtml(title)}</title><style>body{font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a}.sagip-report-document{max-width:900px;margin:0 auto;background:white;padding:32px;border-radius:18px}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}th{background:#eff6ff}h1,h2{color:#075985}.report-kpi-grid,.report-cover-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.report-kpi,.report-cover-grid div{border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#f8fafc}.report-alert-strip{padding:16px;border-radius:14px;margin-top:18px;background:#eff6ff}</style></head><body>${latestSagipReportHtml}</body></html>`;
    downloadTextFile(fullHtml, `sagip-report-${getReportTimestampSlug()}.html`, "text/html");
}

function downloadSagipReportJson() {
    const context = getSagipReportContext();
    const readiness = getSagipReportReadiness(context);
    const options = getReportOptions();
    const reportData = buildSagipReportData(context, readiness, options);
    const payload = { metadata: reportData.meta, readiness: reportData.readiness, key_findings: reportData.keyFindings, terrain: reportData.terrain, rainfall_forecast: reportData.forecast, flood_simulation: reportData.flood, vulnerability: reportData.vulnerability, water_bodies: reportData.waterBodies, water_summary: reportData.waterSummary };
    downloadTextFile(JSON.stringify(payload, null, 2), `sagip-report-data-${getReportTimestampSlug()}.json`, "application/json");
}

function downloadSagipReportCsvBundle() {
    const context = getSagipReportContext();
    const vulnerability = context.vulnerability || {};
    const flood = context.floodSimulation || {};
    const text = ["=== vulnerability_summary.csv ===", buildSummaryCsv(context), "", "=== hotspots.csv ===", buildHotspotsCsv(vulnerability.hotspots || []), "", "=== safe_zones.csv ===", buildSafeZonesCsv(vulnerability.safe_zones || []), "", "=== flood_timeline.csv ===", buildTimelineCsv(flood.snapshots || [])].join("\n");
    downloadTextFile(text, `sagip-report-tables-${getReportTimestampSlug()}.txt`, "text/plain");
}

function buildSummaryCsv(context) {
    const v = context.vulnerability?.summary || {};
    const terrain = context.terrain?.summary || {};
    return ["metric,value", csvRow("overall_level", v.overall_level || ""), csvRow("overall_score", v.overall_score ?? ""), csvRow("peak_depth_cm", v.peak_depth_cm ?? ""), csvRow("earliest_impact_hour", v.earliest_impact_hour ?? ""), csvRow("critical_cell_count", v.critical_cell_count ?? ""), csvRow("high_cell_count", v.high_cell_count ?? ""), csvRow("terrain_type", terrain.terrain_type || ""), csvRow("elevation_range_m", terrain.elevation_range_m ?? "")].join("\n");
}
function buildHotspotsCsv(hotspots) { return ["rank,id,risk_class,score,max_depth_cm,first_impact_hour,average_duration_hours,estimated_area_km2,recommended_action", ...hotspots.map((i) => [i.rank,i.id,i.risk_class,i.score,i.max_depth_cm,i.first_impact_hour ?? "",i.average_duration_hours,i.estimated_area_km2,i.recommended_action].map(csvEscape).join(","))].join("\n"); }
function buildSafeZonesCsv(zones) { return ["rank,id,average_elevation_m,estimated_area_km2,average_vulnerability_score,note", ...zones.map((i) => [i.rank,i.id,i.average_elevation_m,i.estimated_area_km2,i.average_vulnerability_score,i.note].map(csvEscape).join(","))].join("\n"); }
function buildTimelineCsv(snapshots) { return ["hour_index,rainfall_mm,flooded_cell_count,max_depth_cm,high_or_severe_cell_count", ...snapshots.map((i) => [i.hour_index ?? "",i.rainfall_mm ?? "",i.flooded_cell_count ?? "",i.max_depth_cm ?? "",i.high_or_severe_cell_count ?? ""].map(csvEscape).join(","))].join("\n"); }

function getReportBoundsFromTerrain(terrain) { const lats = terrain?.latitudes || []; const lngs = terrain?.longitudes || []; if (!lats.length || !lngs.length) return null; return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }; }
function getMaxFloodDepthFromSnapshots(snapshots) { return (snapshots || []).reduce((m, s) => Math.max(m, Number(s.max_depth_cm || 0)), 0); }
function getMaxFloodedCells(snapshots) { const m = (snapshots || []).reduce((a, s) => Math.max(a, Number(s.flooded_cell_count || 0)), 0); return m || "—"; }
function estimateReportRiskFromDepth(depth) { depth = Number(depth || 0); if (depth >= 100) return "Critical"; if (depth >= 60) return "High"; if (depth >= 25) return "Moderate"; if (depth >= 5) return "Low"; return "Minimal"; }
function setReportStatusMessage(message, mode) { const e = document.getElementById("report-status-message"); if (e) { e.textContent = message; e.className = `report-status-message ${mode || "info"}`; } }
function setReportText(id, value) { const e = document.getElementById(id); if (e) e.textContent = value; }
function formatNumber(value, suffix = "") { if (value === null || value === undefined || value === "") return "—"; const n = Number(value); if (Number.isNaN(n)) return "—"; return `${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}${suffix}`; }
function capitalizeReportText(value) { const text = String(value || ""); return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown"; }
function escapeReportHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function csvEscape(value) { const text = String(value ?? ""); return text.includes(",") || text.includes('"') || text.includes("\n") ? `"${text.replaceAll('"', '""')}"` : text; }
function csvRow(metric, value) { return `${csvEscape(metric)},${csvEscape(value)}`; }
function downloadTextFile(text, filename, mimeType) { const blob = new Blob([text], { type: mimeType }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 0); }
function getReportTimestampSlug() { return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-").slice(0, 19); }

document.addEventListener("DOMContentLoaded", initializeSagipReports);
