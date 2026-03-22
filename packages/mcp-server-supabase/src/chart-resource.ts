import { resource, resources } from '@supabase/mcp-utils';

export const EXECUTE_SQL_CHART_RESOURCE_URI = 'charts/render';

const RENDER_CHART_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Supabase SQL Chart</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: currentColor;
        background: color-mix(in srgb, currentColor 3%, transparent);
      }

      .shell {
        padding: 16px;
      }

      .panel {
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 20px;
        background: color-mix(in srgb, currentColor 2%, white 96%);
        overflow: hidden;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      }

      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        opacity: 0.6;
      }

      .title {
        margin-top: 4px;
        font-size: 15px;
        font-weight: 700;
      }

      .save-button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #10b981, #2563eb);
        cursor: pointer;
      }

      .save-button:disabled {
        cursor: default;
        opacity: 0.45;
      }

      #chart {
        width: 100%;
        height: 420px;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <div class="toolbar">
          <div>
            <div class="eyebrow">Supabase SQL chart</div>
            <div class="title" id="chart-title">Waiting for query results</div>
          </div>
          <button class="save-button" id="save-button" disabled>Uložiť graf</button>
        </div>
        <div id="chart"></div>
      </div>
    </div>

    <script>
      const chartNode = document.getElementById("chart");
      const chartTitle = document.getElementById("chart-title");
      const saveButton = document.getElementById("save-button");
      const chart = echarts.init(chartNode, null, { renderer: "canvas" });
      let latestPayload = null;

      function postToHost(message) {
        window.parent.postMessage(message, "*");
      }

      function postSize() {
        postToHost({
          jsonrpc: "2.0",
          method: "ui/notifications/size-changed",
          params: { height: document.documentElement.scrollHeight },
        });
      }

      function normalizeNumber(value) {
        if (typeof value === "number") return Number.isFinite(value) ? value : 0;
        if (typeof value === "string") {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
      }

      function getSeriesKeys(config) {
        return Array.isArray(config.y_axis) ? config.y_axis : [config.y_axis];
      }

      function categoryValues(data, key) {
        return data.map((row) => String(row?.[key] ?? ""));
      }

      function buildRangeBand(data, seriesKeys) {
        const [avgKey, minKey, maxKey] = seriesKeys.length >= 3
          ? seriesKeys
          : [null, seriesKeys[0], seriesKeys[1]];
        const lows = data.map((row) => normalizeNumber(row[minKey]));
        const highs = data.map((row) => normalizeNumber(row[maxKey]));
        const spreads = highs.map((high, index) => Math.max(high - lows[index], 0));
        const series = [
          {
            name: "range-start",
            type: "bar",
            stack: "range",
            itemStyle: { color: "transparent" },
            emphasis: { disabled: true },
            tooltip: { show: false },
            data: lows,
          },
          {
            name: maxKey || "range",
            type: "bar",
            stack: "range",
            itemStyle: { color: "rgba(37, 99, 235, 0.24)", borderRadius: 999 },
            data: spreads,
          },
        ];
        if (avgKey) {
          series.push({
            name: avgKey,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#0f172a" },
            data: data.map((row) => normalizeNumber(row[avgKey])),
          });
        }
        return series;
      }

      function buildLineRangeSeries(data, seriesKeys) {
        const [avgKey, minKey, maxKey] = seriesKeys.length >= 3
          ? seriesKeys
          : [null, seriesKeys[0], seriesKeys[1]];
        const lowData = data.map((row) => normalizeNumber(row[minKey]));
        const highData = data.map((row) => normalizeNumber(row[maxKey]));
        const band = highData.map((high, index) => Math.max(high - lowData[index], 0));
        const series = [
          {
            name: minKey || "min",
            type: "line",
            stack: "range-band",
            lineStyle: { opacity: 0 },
            symbol: "none",
            areaStyle: { opacity: 0 },
            data: lowData,
          },
          {
            name: maxKey || "range",
            type: "line",
            stack: "range-band",
            lineStyle: { opacity: 0 },
            symbol: "none",
            areaStyle: { color: "rgba(37, 99, 235, 0.18)" },
            data: band,
          },
        ];
        if (avgKey) {
          series.push({
            name: avgKey,
            type: "line",
            smooth: true,
            lineStyle: { width: 3 },
            data: data.map((row) => normalizeNumber(row[avgKey])),
          });
        } else {
          series.push({
            name: minKey || "min",
            type: "line",
            smooth: true,
            data: lowData,
          });
          series.push({
            name: maxKey || "max",
            type: "line",
            smooth: true,
            data: highData,
          });
        }
        return series;
      }

      function buildBoxplotSeries(data, config, seriesKeys) {
        const stats = data.map((row) => seriesKeys.map((key) => normalizeNumber(row[key])));
        return [{
          name: config.title || "distribution",
          type: "boxplot",
          data: stats,
        }];
      }

      function buildRadarSeries(data, config, seriesKeys) {
        const indicators = data.map((row) => ({
          name: String(row?.[config.x_axis] ?? ""),
          max: Math.max(...seriesKeys.map((key) => normalizeNumber(row[key])), 1),
        }));
        return {
          radar: { indicator: indicators },
          series: seriesKeys.map((key) => ({
            name: key,
            type: "radar",
            data: [{ value: data.map((row) => normalizeNumber(row[key])), name: key }],
          })),
        };
      }

      function buildChordSeries(data) {
        const names = Array.from(new Set(data.flatMap((row) => [String(row?.source ?? row?.from ?? ""), String(row?.target ?? row?.to ?? "")]).filter(Boolean)));
        return [{
          type: "graph",
          layout: "circular",
          circular: { rotateLabel: true },
          roam: true,
          label: { show: true },
          data: names.map((name) => ({ name })),
          links: data.map((row) => ({
            source: String(row?.source ?? row?.from ?? ""),
            target: String(row?.target ?? row?.to ?? ""),
            value: normalizeNumber(row?.value ?? row?.weight ?? row?.count),
          })),
          lineStyle: { curveness: 0.2, opacity: 0.5 },
        }];
      }

      function buildBeeswarmSeries(data, config, seriesKeys) {
        const categories = Array.from(new Set(categoryValues(data, config.x_axis)));
        const categoryIndex = new Map(categories.map((value, index) => [value, index]));
        return seriesKeys.map((key) => ({
          name: key,
          type: "scatter",
          symbolSize: 10,
          data: data.map((row, index) => {
            const category = String(row?.[config.x_axis] ?? "");
            const jitter = ((index % 7) - 3) * 0.06;
            return [normalizeNumber(row[key]), (categoryIndex.get(category) ?? 0) + jitter, category];
          }),
        }));
      }

      function buildOption(payload) {
        const config = payload.chartConfig || payload;
        const data = Array.isArray(payload.rows) ? payload.rows : Array.isArray(config.data) ? config.data : [];
        const seriesKeys = getSeriesKeys(config);
        const chartType = config.chart_type;
        const isPie = chartType === "pie";
        const isScatter = chartType === "scatter";
        const isFunnel = chartType === "funnel";
        const isRadar = chartType === "radar";
        const isChord = chartType === "chord";
        const isBeeswarm = chartType === "beeswarm";
        const isBoxplot = chartType === "boxplot";
        const isBarRange = chartType === "bar_range";
        const isLineRange = chartType === "line_range";

        let radarConfig = null;
        let series;

        if (isPie) {
          series = [{
            name: config.title || seriesKeys[0],
            type: "pie",
            radius: ["34%", "72%"],
            padAngle: 2,
            data: data.map((row) => ({
              name: String(row?.[config.x_axis] ?? ""),
              value: normalizeNumber(row[seriesKeys[0]]),
            })),
          }];
        } else if (isFunnel) {
          series = [{
            name: config.title || seriesKeys[0],
            type: "funnel",
            left: "10%",
            width: "80%",
            data: data.map((row) => ({
              name: String(row?.[config.x_axis] ?? ""),
              value: normalizeNumber(row[seriesKeys[0]]),
            })),
          }];
        } else if (isRadar) {
          radarConfig = buildRadarSeries(data, config, seriesKeys);
          series = radarConfig.series;
        } else if (isChord) {
          series = buildChordSeries(data);
        } else if (isBeeswarm) {
          series = buildBeeswarmSeries(data, config, seriesKeys);
        } else if (isBoxplot) {
          series = buildBoxplotSeries(data, config, seriesKeys);
        } else if (isBarRange) {
          series = buildRangeBand(data, seriesKeys);
        } else if (isLineRange) {
          series = buildLineRangeSeries(data, seriesKeys);
        } else {
          series = seriesKeys.map((key) => ({
            name: key,
            type: chartType === "area" ? "line" : chartType,
            smooth: chartType === "line" || chartType === "area",
            areaStyle: chartType === "area" ? { opacity: 0.16 } : undefined,
            symbolSize: chartType === "scatter" ? 10 : undefined,
            data: chartType === "scatter"
              ? data.map((row) => [normalizeNumber(row[config.x_axis]), normalizeNumber(row[key])])
              : data.map((row) => normalizeNumber(row[key])),
          }));
        }

        return {
          backgroundColor: "transparent",
          animationDuration: 600,
          title: {
            text: config.title || payload.title || "SQL chart",
            subtext: config.subtitle || payload.subtitle || "",
            left: 0,
            top: 0,
          },
          tooltip: {
            trigger: isPie || isFunnel ? "item" : "axis",
          },
          legend: {
            show: !isRadar && !isChord,
            top: 8,
            right: 0,
          },
          grid: isPie || isFunnel || isRadar || isChord ? undefined : {
            left: 12,
            right: 12,
            top: 72,
            bottom: 12,
            containLabel: true,
          },
          xAxis: isPie || isFunnel || isRadar || isChord
            ? undefined
            : isBeeswarm
              ? {
                  type: "value",
                  axisLabel: { formatter: "{value}" },
                }
              : {
                  type: isScatter ? "value" : "category",
                  data: isScatter ? undefined : categoryValues(data, config.x_axis),
                  boundaryGap: chartType === "bar" || isBarRange,
                },
          yAxis: isPie || isFunnel || isRadar || isChord
            ? undefined
            : isBeeswarm
              ? {
                  type: "category",
                  data: Array.from(new Set(categoryValues(data, config.x_axis))),
                }
              : {
                  type: "value",
                },
          radar: radarConfig?.radar,
          series,
        };
      }

      function extractPayload(params) {
        if (params && params.structuredContent && typeof params.structuredContent === "object") {
          return params.structuredContent;
        }
        const firstText = params && Array.isArray(params.content)
          ? params.content.find((item) => item && item.type === "text")
          : null;
        if (!firstText || typeof firstText.text !== "string") return null;
        try {
          return JSON.parse(firstText.text);
        } catch {
          return null;
        }
      }

      function renderPayload(payload) {
        if (!payload || typeof payload !== "object") return;
        latestPayload = payload;
        const config = payload.chartConfig || payload;
        chartTitle.textContent = config.title || payload.title || "SQL chart";
        chart.setOption(buildOption(payload), true);
        saveButton.disabled = false;
        requestAnimationFrame(postSize);
      }

      saveButton.addEventListener("click", () => {
        if (!latestPayload) return;
        postToHost({
          type: "copero-save-chart",
          payload: latestPayload,
        });
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") return;
        if (message.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
          const payload = extractPayload(message.params);
          if (payload) renderPayload(payload);
        }
      });

      postToHost({
        jsonrpc: "2.0",
        id: "init",
        method: "ui/initialize",
        params: { protocolVersion: "2025-11-21" },
      });

      window.addEventListener("resize", () => {
        chart.resize();
        postSize();
      });
    </script>
  </body>
</html>`;

export function getChartResources() {
  return resources('ui', [
    resource(EXECUTE_SQL_CHART_RESOURCE_URI, {
      name: 'SQL Chart Renderer',
      description: 'Renders SQL results as ECharts visualizations.',
      mimeType: 'text/html',
      read: async (uri) => ({
        uri,
        mimeType: 'text/html',
        text: RENDER_CHART_HTML,
      }),
    }),
  ]);
}
