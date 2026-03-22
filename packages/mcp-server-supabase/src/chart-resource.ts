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
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: currentColor;
        background:
          radial-gradient(circle at top left, color-mix(in srgb, #5b7cfa 12%, transparent), transparent 34%),
          radial-gradient(circle at bottom right, color-mix(in srgb, #55b6a9 12%, transparent), transparent 30%),
          color-mix(in srgb, currentColor 3%, transparent);
      }

      .shell {
        padding: 16px;
      }

      .panel {
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 20px;
        background: color-mix(in srgb, currentColor 2%, white 96%);
        overflow: hidden;
        box-shadow: 0 22px 60px rgba(15, 23, 42, 0.08);
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      }

      .chart-title {
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: color-mix(in srgb, currentColor 68%, transparent);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .save-button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #5b7cfa, #55b6a9);
        cursor: pointer;
      }

      .save-button:disabled {
        cursor: default;
        opacity: 0.45;
      }

      #chart {
        width: 100%;
        height: clamp(340px, 60vh, 460px);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <div class="toolbar">
          <div class="chart-title" id="chart-title"></div>
          <button class="save-button" id="save-button" disabled>Uložiť graf</button>
        </div>
        <div id="chart"></div>
      </div>
    </div>

    <script>
      const chartNode = document.getElementById("chart");
      const chartTitleNode = document.getElementById("chart-title");
      const saveButton = document.getElementById("save-button");
      const chart = echarts.init(chartNode, null, { renderer: "canvas" });
      const seriesColors = ["#5b7cfa", "#55b6a9", "#d7a54b", "#8a78d8"];
      const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
      const compactNumberFormatter = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      });
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

      function formatValue(value) {
        if (Array.isArray(value)) {
          return formatValue(value[value.length - 1]);
        }
        if (typeof value === "number") {
          return numberFormatter.format(value);
        }
        if (typeof value === "string") {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? numberFormatter.format(parsed) : value;
        }
        return String(value ?? "");
      }

      function formatAxisValue(value) {
        const numeric = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(numeric)) return String(value ?? "");
        return Math.abs(numeric) >= 1000
          ? compactNumberFormatter.format(numeric)
          : numberFormatter.format(numeric);
      }

      function buildTooltipFormatter() {
        return function formatter(params) {
          const items = Array.isArray(params) ? params : [params];
          const first = items[0];
          if (!first) return "";

          if (items.length === 1 && !first.axisValueLabel) {
            return (first.marker || "") + (first.name || "") + ": " + formatValue(first.value);
          }

          const title = first.axisValueLabel || first.name || "";
          const lines = items.map((item) =>
            (item.marker || "") + (item.seriesName || "") + ": " + formatValue(item.value)
          );
          return [title, ...lines].join("<br/>");
        };
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
            barMaxWidth: 28,
            itemStyle: {
              color: "rgba(91, 124, 250, 0.24)",
              borderRadius: 999,
            },
            data: spreads,
          },
        ];
        if (avgKey) {
          series.push({
            name: avgKey,
            type: "scatter",
            symbolSize: 9,
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
            areaStyle: { color: "rgba(91, 124, 250, 0.18)" },
            data: band,
          },
        ];
        if (avgKey) {
          series.push({
            name: avgKey,
            type: "line",
            smooth: false,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 3 },
            data: data.map((row) => normalizeNumber(row[avgKey])),
          });
        } else {
          series.push({
            name: minKey || "min",
            type: "line",
            smooth: false,
            symbol: "circle",
            symbolSize: 6,
            data: lowData,
          });
          series.push({
            name: maxKey || "max",
            type: "line",
            smooth: false,
            symbol: "circle",
            symbolSize: 6,
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
          itemStyle: {
            color: "rgba(91, 124, 250, 0.2)",
            borderColor: seriesColors[0],
          },
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
          series: seriesKeys.map((key, index) => ({
            name: key,
            type: "radar",
            lineStyle: { width: 2 },
            itemStyle: { color: seriesColors[index % seriesColors.length] },
            areaStyle: { opacity: 0.12 },
            data: [{ value: data.map((row) => normalizeNumber(row[key])), name: key }],
          })),
        };
      }

      function buildChordSeries(data) {
        const names = Array.from(
          new Set(
            data.flatMap((row) => [
              String(row?.source ?? row?.from ?? ""),
              String(row?.target ?? row?.to ?? ""),
            ]).filter(Boolean)
          )
        );
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
        return seriesKeys.map((key, index) => ({
          name: key,
          type: "scatter",
          symbolSize: 10,
          itemStyle: { color: seriesColors[index % seriesColors.length] },
          data: data.map((row, rowIndex) => {
            const category = String(row?.[config.x_axis] ?? "");
            const jitter = ((rowIndex % 7) - 3) * 0.06;
            return [normalizeNumber(row[key]), (categoryIndex.get(category) ?? 0) + jitter, category];
          }),
        }));
      }

      function buildCartesianSeries(data, config, seriesKeys, chartType) {
        return seriesKeys.map((key, index) => ({
          name: key,
          type: chartType === "area" ? "line" : chartType,
          smooth: false,
          lineStyle:
            chartType === "line" || chartType === "area"
              ? { width: 3, color: seriesColors[index % seriesColors.length] }
              : undefined,
          itemStyle: {
            color: seriesColors[index % seriesColors.length],
            borderRadius: chartType === "bar" ? [8, 8, 0, 0] : undefined,
          },
          areaStyle:
            chartType === "area"
              ? {
                  opacity: 0.16,
                  color: seriesColors[index % seriesColors.length],
                }
              : undefined,
          symbol: chartType === "scatter" ? "circle" : "emptyCircle",
          symbolSize: chartType === "scatter" ? 10 : 7,
          barMaxWidth: chartType === "bar" ? 32 : undefined,
          data: chartType === "scatter"
            ? data.map((row) => [normalizeNumber(row[config.x_axis]), normalizeNumber(row[key])])
            : data.map((row) => normalizeNumber(row[key])),
        }));
      }

      function buildMixLineBarSeries(data, seriesKeys) {
        const [barKey, lineKey] = seriesKeys;
        const series = [
          {
            name: barKey,
            type: "bar",
            yAxisIndex: 0,
            barMaxWidth: 32,
            itemStyle: {
              color: seriesColors[0],
              borderRadius: [8, 8, 0, 0],
            },
            emphasis: { focus: "series" },
            data: data.map((row) => normalizeNumber(row[barKey])),
          },
        ];

        if (lineKey) {
          series.push({
            name: lineKey,
            type: "line",
            yAxisIndex: 1,
            smooth: false,
            symbol: "circle",
            symbolSize: 8,
            lineStyle: { width: 3, color: seriesColors[1] },
            itemStyle: { color: seriesColors[1] },
            emphasis: { focus: "series" },
            data: data.map((row) => normalizeNumber(row[lineKey])),
          });
        }

        return series;
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
        const isMixLineBar = chartType === "mix-line-bar";

        let radarConfig = null;
        let series;

        if (isPie) {
          series = [{
            name: config.title || seriesKeys[0],
            type: "pie",
            radius: ["34%", "72%"],
            padAngle: 2,
            data: data.map((row, index) => ({
              name: String(row?.[config.x_axis] ?? ""),
              value: normalizeNumber(row[seriesKeys[0]]),
              itemStyle: { color: seriesColors[index % seriesColors.length] },
            })),
          }];
        } else if (isFunnel) {
          series = [{
            name: config.title || seriesKeys[0],
            type: "funnel",
            left: "10%",
            width: "80%",
            itemStyle: { color: seriesColors[0] },
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
        } else if (isMixLineBar) {
          series = buildMixLineBarSeries(data, seriesKeys);
        } else {
          series = buildCartesianSeries(data, config, seriesKeys, chartType);
        }

        return {
          color: seriesColors,
          backgroundColor: "transparent",
          animationDuration: 600,
          title: { show: false },
          tooltip: {
            trigger: isPie || isFunnel ? "item" : "axis",
            backgroundColor: "rgba(15, 23, 42, 0.94)",
            borderWidth: 0,
            padding: [10, 12],
            textStyle: { color: "#f8fafc" },
            formatter: buildTooltipFormatter(),
          },
          legend: {
            show: !isRadar && !isChord && (series.length > 1 || isPie || isFunnel),
            top: 8,
            right: 0,
            icon: "circle",
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: "#64748b" },
          },
          grid: isPie || isFunnel || isRadar || isChord ? undefined : {
            left: 20,
            right: isMixLineBar ? 24 : 20,
            top: 84,
            bottom: 20,
            containLabel: true,
          },
          xAxis: isPie || isFunnel || isRadar || isChord
            ? undefined
            : isBeeswarm
              ? {
                  type: "value",
                  axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.3)" } },
                  axisTick: { show: false },
                  axisLabel: { formatter: (value) => formatAxisValue(value) },
                }
              : {
                  type: isScatter ? "value" : "category",
                  data: isScatter ? undefined : categoryValues(data, config.x_axis),
                  boundaryGap: chartType === "bar" || isBarRange || isMixLineBar,
                  axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.3)" } },
                  axisTick: { show: false },
                  axisLabel: { color: "#64748b" },
                  splitLine: isScatter ? { lineStyle: { color: "rgba(148, 163, 184, 0.14)" } } : undefined,
                },
          yAxis: isPie || isFunnel || isRadar || isChord
            ? undefined
            : isBeeswarm
              ? {
                  type: "category",
                  data: Array.from(new Set(categoryValues(data, config.x_axis))),
                  axisLine: { show: false },
                  axisTick: { show: false },
                  axisLabel: { color: "#64748b" },
                }
              : isMixLineBar
                ? [
                    {
                      type: "value",
                      name: seriesKeys[0],
                      axisLine: {
                        show: true,
                        lineStyle: { color: "rgba(148, 163, 184, 0.3)" },
                      },
                      axisTick: { show: false },
                      axisLabel: {
                        color: "#64748b",
                        formatter: (value) => formatAxisValue(value),
                      },
                      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.14)" } },
                    },
                    {
                      type: "value",
                      name: seriesKeys[1] || "",
                      position: "right",
                      axisLine: {
                        show: true,
                        lineStyle: { color: "rgba(148, 163, 184, 0.3)" },
                      },
                      axisTick: { show: false },
                      axisLabel: {
                        color: "#64748b",
                        formatter: (value) => formatAxisValue(value),
                      },
                      splitLine: { show: false },
                    },
                  ]
                : {
                    type: "value",
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      formatter: (value) => formatAxisValue(value),
                    },
                    splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.14)" } },
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
        chartTitleNode.textContent = typeof payload.title === "string"
          ? payload.title
          : typeof payload.chartConfig?.title === "string"
            ? payload.chartConfig.title
            : "";
        chart.setOption(buildOption(payload), true);
        saveButton.disabled = false;
        requestAnimationFrame(() => {
          chart.resize();
          postSize();
        });
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
