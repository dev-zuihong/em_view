import { type RefObject, useEffect, useMemo, useState } from "react";

interface VirtualRowsOptions {
  count: number;
  rowHeight: number;
  overscan?: number;
}

export function useVirtualRows<T extends HTMLElement>(
  ref: RefObject<T>,
  { count, rowHeight, overscan = 10 }: VirtualRowsOptions,
) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateViewport = () => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    const handleScroll = () => setScrollTop(element.scrollTop);

    updateViewport();
    element.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const maxScrollTop = Math.max(0, count * rowHeight - element.clientHeight);
    if (element.scrollTop > maxScrollTop) {
      element.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [count, ref, rowHeight]);

  return useMemo(() => {
    const safeRowHeight = Math.max(1, rowHeight);
    const visibleCount = Math.ceil(viewportHeight / safeRowHeight);
    const baseStart = Math.floor(scrollTop / safeRowHeight);
    const startIndex = Math.max(0, baseStart - overscan);
    const endIndex = Math.min(count, baseStart + visibleCount + overscan);

    return {
      startIndex,
      endIndex,
      offsetTop: startIndex * safeRowHeight,
      totalHeight: count * safeRowHeight,
    };
  }, [count, overscan, rowHeight, scrollTop, viewportHeight]);
}
