import { useRef, useState } from "react";
import { derivePositionProtectionPrice, validatePositionProtectionPrice, type PositionProtectionField, type PositionProtectionSnapshot } from "@/lib/positionProtectionValidation";

type ProtectionStatus = "idle" | "saving" | "saved" | "error";

interface PositionProtectionOverlayProps {
  position: PositionProtectionSnapshot & {
    id: string;
    symbol: string;
    stopLoss: number | null;
    takeProfit: number | null;
  };
  priceToCoordinate: (price: number) => number | null;
  coordinateToPrice: (coordinate: number) => number | null;
  getChartTop: () => number;
  onCommit: (field: PositionProtectionField, price: number) => Promise<void>;
  layoutRevision?: number;
}

interface ActiveDrag {
  field: PositionProtectionField;
  pointerId: number;
  price: number;
}

const roundToTick = (price: number, tickSize: number) => Number((Math.round(price / tickSize) * tickSize).toFixed(8));

export function PositionProtectionOverlay({ position, priceToCoordinate, coordinateToPrice, getChartTop, onCommit, layoutRevision }: PositionProtectionOverlayProps) {
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [status, setStatus] = useState<Partial<Record<PositionProtectionField, ProtectionStatus>>>({});
  const [errorMessage, setErrorMessage] = useState("");

  const beginDrag = (field: PositionProtectionField, price: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (status[field] === "saving") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { field, pointerId: event.pointerId, price };
    activeDragRef.current = next;
    setActiveDrag(next);
    setStatus((previous) => ({ ...previous, [field]: "idle" }));
    setErrorMessage("");
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = activeDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const priceAtPointer = coordinateToPrice(event.clientY - getChartTop());
    if (priceAtPointer == null || !Number.isFinite(priceAtPointer)) return;
    const next = { ...current, price: roundToTick(priceAtPointer, position.tickSize) };
    activeDragRef.current = next;
    setActiveDrag(next);
  };

  const endDrag = async (event: React.PointerEvent<HTMLDivElement>) => {
    const current = activeDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    activeDragRef.current = null;
    setActiveDrag(null);

    const validation = validatePositionProtectionPrice(current.field, current.price, position);
    if (!validation.valid) {
      setStatus((previous) => ({ ...previous, [current.field]: "error" }));
      setErrorMessage(validation.message ?? "Protection price is invalid.");
      return;
    }

    setStatus((previous) => ({ ...previous, [current.field]: "saving" }));
    setErrorMessage("");
    try {
      await onCommit(current.field, current.price);
      setStatus((previous) => ({ ...previous, [current.field]: "saved" }));
      window.setTimeout(() => setStatus((previous) => ({ ...previous, [current.field]: "idle" })), 1600);
    } catch (error) {
      setStatus((previous) => ({ ...previous, [current.field]: "error" }));
      setErrorMessage(error instanceof Error ? error.message : "Protection update failed.");
    }
  };

  const renderLevel = (field: PositionProtectionField, persistedPrice: number | null, label: string) => {
    const effectivePrice = persistedPrice ?? derivePositionProtectionPrice(field, position);
    const isDragging = activeDrag?.field === field;
    const displayedPrice = isDragging ? activeDrag.price : effectivePrice;
    const coordinate = priceToCoordinate(displayedPrice);
    if (coordinate == null || !Number.isFinite(coordinate)) return null;
    const fieldStatus = status[field] ?? "idle";
    const color = field === "stop_loss" ? "border-red-500 text-red-700 dark:text-red-300" : "border-emerald-500 text-emerald-700 dark:text-emerald-300";
    const lineColor = field === "stop_loss" ? "border-red-500" : "border-emerald-500";
    return (
      <div
        key={`${position.id}:${field}`}
        role="slider"
        tabIndex={0}
        aria-label={`${label} ${displayedPrice.toFixed(2)}`}
        aria-valuenow={displayedPrice}
        data-protection-field={field}
        data-protection-status={fieldStatus}
        className="absolute inset-x-0 z-20 h-5 -translate-y-1/2 cursor-ns-resize touch-none select-none"
        style={{ top: coordinate, touchAction: "none", cursor: isDragging ? "grabbing" : "ns-resize" }}
        onPointerDown={(event) => beginDrag(field, effectivePrice, event)}
        onPointerMove={moveDrag}
        onPointerUp={(event) => { void endDrag(event); }}
        onPointerCancel={(event) => { if (activeDragRef.current?.pointerId === event.pointerId) { activeDragRef.current = null; setActiveDrag(null); } }}
        onLostPointerCapture={(event) => { if (activeDragRef.current?.pointerId === event.pointerId) { activeDragRef.current = null; setActiveDrag(null); } }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const basePrice = persistedPrice ?? derivePositionProtectionPrice(field, position);
          const nextPrice = roundToTick(basePrice + (event.key === "ArrowUp" ? 1 : -1) * position.tickSize, position.tickSize);
          const validation = validatePositionProtectionPrice(field, nextPrice, position);
          if (!validation.valid) { setErrorMessage(validation.message ?? "Protection price is invalid."); return; }
          setStatus((previous) => ({ ...previous, [field]: "saving" }));
          void onCommit(field, nextPrice).then(
            () => setStatus((previous) => ({ ...previous, [field]: "saved" })),
            (error: unknown) => { setStatus((previous) => ({ ...previous, [field]: "error" })); setErrorMessage(error instanceof Error ? error.message : "Protection update failed."); },
          );
        }}
      >
        <div className={`absolute inset-x-0 top-1/2 border-t-2 border-dashed ${lineColor} ${isDragging ? "opacity-100" : "opacity-80"}`} />
        <span className={`absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-card px-2 py-0.5 font-mono text-[11px] font-semibold shadow ${color}`}>
          {fieldStatus === "saving" ? "Saving… " : fieldStatus === "saved" ? "Saved " : ""}{label} {displayedPrice.toFixed(2)}
        </span>
      </div>
    );
  };

  return (
    <>
      <div data-layout-revision={layoutRevision} />
      {renderLevel("stop_loss", position.stopLoss, "SL")}
      {renderLevel("take_profit", position.takeProfit, "TP")}
      {errorMessage && <div role="alert" className="absolute left-2 top-2 z-30 max-w-[min(80%,440px)] rounded border border-destructive/50 bg-card px-2 py-1 text-xs text-destructive shadow">{errorMessage}</div>}
    </>
  );
}