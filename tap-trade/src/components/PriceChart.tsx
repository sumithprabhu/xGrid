import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  AreaSeries,
  LineStyle,
  LineType,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  UTCTimestamp,
} from "lightweight-charts";
import type { PricePoint } from "../lib/types";

export interface ChartHandle {
  timeToX: (time: number) => number | null;
  priceToY: (price: number) => number | null;
}

interface Props {
  history: PricePoint[];
  currentPrice: number;
  tickSize: number;
  gridHalfHeight: number;
}

export const PriceChart = forwardRef<ChartHandle, Props>(function PriceChart(
  { history, currentPrice, tickSize, gridHalfHeight },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<
    ReturnType<ISeriesApi<"Line">["createPriceLine"]>[]
  >([]);
  const markersRef = useRef<ISeriesMarkersPluginApi | null>(null);

  useImperativeHandle(ref, () => ({
    timeToX(time: number) {
      return (
        chartRef.current
          ?.timeScale()
          .timeToCoordinate(time as UTCTimestamp) ?? null
      );
    },
    priceToY(price: number) {
      return lineRef.current?.priceToCoordinate(price) ?? null;
    },
  }));

  // Mount chart
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { color: "#000000" },
        textColor: "#333",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.025)" },
        horzLines: { color: "rgba(255,255,255,0.015)" },
      },
      rightPriceScale: { visible: false },
      timeScale: {
        visible: false,
        rightOffset: 80, // positions dot inside the grid area
        barSpacing: 6,
      },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    // Glow area underneath the line
    const area = chart.addSeries(AreaSeries, {
      topColor: "rgba(16,185,129,0.08)",
      bottomColor: "rgba(16,185,129,0)",
      lineColor: "transparent",
      lineWidth: 0,
      lineType: LineType.Curved,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const line = chart.addSeries(LineSeries, {
      color: "#10b981",
      lineWidth: 2,
      lineType: LineType.Curved,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    lineRef.current = line;
    areaRef.current = area;
    markersRef.current = createSeriesMarkers(line, []);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Push data
  useEffect(() => {
    const line = lineRef.current;
    const area = areaRef.current;
    const chart = chartRef.current;
    if (!line || !area || !chart || history.length === 0) return;

    const mapped = history.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));

    line.setData(mapped);
    area.setData(mapped);

    // White dot at the tip
    markersRef.current?.setMarkers([
      {
        time: mapped[mapped.length - 1].time,
        position: "inBar",
        shape: "circle",
        color: "#ffffff",
        size: 0.6,
      },
    ]);

    chart.timeScale().scrollToRealTime();
  }, [history]);

  // Lock Y-axis to match grid price range + horizontal price lines
  useEffect(() => {
    const line = lineRef.current;
    const area = areaRef.current;
    if (!line || !area) return;

    const center = Math.round(currentPrice / tickSize) * tickSize;
    const halfRange = gridHalfHeight * tickSize;
    const margin = halfRange * 0.15; // small margin so line doesn't clip edges

    // Lock both series to the same price range as the grid
    const provider = () => ({
      priceRange: {
        minValue: center - halfRange - margin,
        maxValue: center + halfRange + margin,
      },
    });
    line.applyOptions({ autoscaleInfoProvider: provider });
    area.applyOptions({ autoscaleInfoProvider: provider });

    // Remove old price lines
    for (const pl of priceLinesRef.current) {
      try {
        line.removePriceLine(pl);
      } catch {
        /* gone */
      }
    }
    priceLinesRef.current = [];

    // Draw horizontal lines at each grid row
    for (let i = -gridHalfHeight; i <= gridHalfHeight; i++) {
      const pl = line.createPriceLine({
        price: center + i * tickSize,
        color: i === 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
      });
      priceLinesRef.current.push(pl);
    }
  }, [currentPrice, tickSize, gridHalfHeight]);

  return <div ref={containerRef} className="w-full h-full" />;
});
