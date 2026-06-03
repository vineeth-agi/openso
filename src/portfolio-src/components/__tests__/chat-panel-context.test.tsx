import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChatPanelProvider, useChatPanel } from "../chat-panel-context";

describe("ChatPanelContext", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ChatPanelProvider>{children}</ChatPanelProvider>
  );

  it("defaults isOpen to false", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    expect(result.current.isOpen).toBe(false);
  });

  it("toggle opens the panel when closed", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
  });

  it("toggle closes the panel when open", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.open());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it("open sets isOpen to true", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it("close sets isOpen to false", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.open());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it("close is idempotent when already closed", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it("open is idempotent when already open", () => {
    const { result } = renderHook(() => useChatPanel(), { wrapper });
    act(() => result.current.open());
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it("throws descriptive error when used outside provider", () => {
    expect(() => {
      renderHook(() => useChatPanel());
    }).toThrow(
      "useChatPanel must be used within a ChatPanelProvider"
    );
  });
});
