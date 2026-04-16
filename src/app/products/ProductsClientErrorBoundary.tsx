"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

/**
 * 상품 목록(병합·정렬·재고 UI)에서 예외가 나도 전역 흰 화면 대신 이 구역만 복구 가능한 메시지로 대체.
 */
export class ProductsClientErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const dbg =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debugStockAdjust") === "1";
    if (dbg) {
      console.info("[stockAdjust][ErrorBoundary] caught", {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        t: performance.now(),
      });
    } else if (typeof console !== "undefined" && console.error) {
      console.error("[ProductsClientErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="products-error-boundary" style={{ padding: 16 }}>
          <p className="muted">상품 목록을 표시하는 중 오류가 발생했습니다. 새로고침하거나 잠시 후 다시 시도해 주세요.</p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: null })}
          >
            다시 시도
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
