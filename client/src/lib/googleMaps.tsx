import { MapPin } from "lucide-react";
import { useEffect, useRef, useState, forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AddressInput =
  | string
  | {
      address?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      label?: string | null;
    };

export function buildGoogleMapsUrl(input: AddressInput): string | null {
  let query = "";
  if (typeof input === "string") {
    query = input.trim();
  } else if (input && typeof input === "object") {
    const street = (input.address || "").trim();
    const city = (input.city || "").trim();
    const state = (input.state || "").trim();
    const zip = (input.zip || "").trim();
    if (!street && !city) return null;
    query = [street, city, state, zip].filter(Boolean).join(", ");
  }
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

interface GoogleMapsLinkProps {
  address: AddressInput;
  testId: string;
  children?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function GoogleMapsLink({
  address,
  testId,
  children,
  className,
  ariaLabel,
}: GoogleMapsLinkProps) {
  const url = buildGoogleMapsUrl(address);
  if (!url) {
    return children ? <span className={className}>{children}</span> : null;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "text-primary hover:underline inline-flex items-center gap-1"
      }
      data-testid={testId}
      aria-label={ariaLabel ?? "View in Google Maps"}
    >
      {children}
    </a>
  );
}

interface GoogleMapsIconLinkProps {
  address: AddressInput;
  testId: string;
  className?: string;
}

export function GoogleMapsIconLink({
  address,
  testId,
  className,
}: GoogleMapsIconLinkProps) {
  const url = buildGoogleMapsUrl(address);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex items-center gap-1 text-xs text-primary hover:underline"
      }
      data-testid={testId}
      title="View in Google Maps"
      aria-label="View in Google Maps"
    >
      <MapPin className="h-3.5 w-3.5" />
      <span>View in Google Maps</span>
    </a>
  );
}

// --- Address Autocomplete (SerpApi-backed proxy) ----------------------------
//
// Predictions come from `GET /api/places/autocomplete` which proxies SerpApi
// with a single server-side key. Each prediction already carries the parsed
// address parts AND lat/lng, so picking one fills the form and surfaces
// coordinates in a single round-trip — no separate "place details" call.

export interface AddressSelection {
  address: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  latitude: number | null;
  longitude: number | null;
}

interface PlacePrediction extends AddressSelection {
  id: string;
  description: string;
}

interface AutocompleteResponse {
  available: boolean;
  predictions: PlacePrediction[];
}

interface AddressAutocompleteInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onSelect" | "onChange" | "value"
  > {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (selection: AddressSelection) => void;
  /** Lowercase ISO-3166 country codes for restriction. Defaults to ["us"]. */
  countries?: string[];
  testId?: string;
  containerClassName?: string;
}

export const AddressAutocompleteInput = forwardRef<
  HTMLInputElement,
  AddressAutocompleteInputProps
>(function AddressAutocompleteInput(
  {
    value,
    onChange,
    onSelect,
    countries = ["us"],
    testId,
    containerClassName,
    className,
    onFocus,
    onBlur,
    onKeyDown,
    ...rest
  },
  ref,
) {
  // `countries` is accepted for API compatibility; the SerpApi proxy biases to
  // US results by default. Intentionally unused here.
  void countries;
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<number | null>(null);
  const skipNextSearch = useRef(false);
  const requestSeq = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onBlur?.(e);
  };

  // Debounced predictions fetch against the server-side proxy.
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (!value || value.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const seq = ++requestSeq.current;
      fetch(`/api/places/autocomplete?q=${encodeURIComponent(value.trim())}`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: AutocompleteResponse | null) => {
          // Ignore stale responses that resolve out of order.
          if (seq !== requestSeq.current) return;
          const preds = data?.predictions ?? [];
          if (preds.length > 0) {
            setPredictions(preds);
            setActiveIdx(-1);
            setOpen(true);
          } else {
            setPredictions([]);
            setOpen(false);
          }
        })
        .catch(() => {
          if (seq !== requestSeq.current) return;
          setPredictions([]);
          setOpen(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value]);

  const pickPrediction = (p: PlacePrediction) => {
    const selection: AddressSelection = {
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      formatted: p.formatted,
      latitude: p.latitude,
      longitude: p.longitude,
    };
    skipNextSearch.current = true;
    onSelect?.(selection);
    onChange(selection.address || selection.formatted);
    setPredictions([]);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (!open || predictions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % predictions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? predictions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < predictions.length) {
        e.preventDefault();
        pickPrediction(predictions[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative", containerClassName)}
      data-testid={testId ? `${testId}-wrapper` : undefined}
    >
      <Input
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={className}
        data-testid={testId}
        autoComplete="off"
      />
      {open && predictions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
          data-testid={testId ? `${testId}-suggestions` : undefined}
        >
          {predictions.map((p, idx) => (
            <li key={p.id || idx}>
              <button
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  // Prevent input blur from closing dropdown before click fires.
                  e.preventDefault();
                }}
                onClick={() => pickPrediction(p)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "block w-full cursor-pointer px-3 py-2 text-left text-sm",
                  idx === activeIdx
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
                data-testid={
                  testId ? `${testId}-suggestion-${idx}` : undefined
                }
              >
                <div className="font-medium">{p.address || p.formatted}</div>
                {(p.city || p.state || p.zip) && (
                  <div className="text-xs text-muted-foreground">
                    {[p.city, [p.state, p.zip].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
