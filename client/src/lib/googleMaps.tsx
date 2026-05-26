import { MapPin } from "lucide-react";
import { useEffect, useRef, useState, useCallback, forwardRef } from "react";
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

// --- Google Places Autocomplete ---------------------------------------------

type AnyGoogle = any;

let googleLoaderPromise: Promise<AnyGoogle | null> | null = null;

function getPlacesApiKey(): string | undefined {
  const key = (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY as
    | string
    | undefined;
  return key && key.trim() ? key.trim() : undefined;
}

export function isAddressAutocompleteAvailable(): boolean {
  return !!getPlacesApiKey();
}

function loadGoogleMaps(): Promise<AnyGoogle | null> {
  if (googleLoaderPromise) return googleLoaderPromise;
  const key = getPlacesApiKey();
  if (!key || typeof window === "undefined") {
    googleLoaderPromise = Promise.resolve(null);
    return googleLoaderPromise;
  }
  googleLoaderPromise = new Promise<AnyGoogle | null>((resolve) => {
    const w = window as any;
    if (w.google?.maps?.places) {
      resolve(w.google);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-google-places-loader]",
    );
    const onLoad = () => resolve((window as any).google ?? null);
    const onError = () => resolve(null);
    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key,
    )}&libraries=places&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.googlePlacesLoader = "true";
    script.onload = onLoad;
    script.onerror = onError;
    document.head.appendChild(script);
  }).catch(() => null);
  return googleLoaderPromise;
}

export interface AddressSelection {
  address: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
}

function parseAddressComponents(place: any): AddressSelection {
  const comps: any[] = place?.address_components || [];
  const get = (type: string) =>
    comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const streetNumber = get("street_number")?.long_name || "";
  const route = get("route")?.long_name || get("route")?.short_name || "";
  const city =
    get("locality")?.long_name ||
    get("postal_town")?.long_name ||
    get("sublocality")?.long_name ||
    get("sublocality_level_1")?.long_name ||
    get("administrative_area_level_2")?.long_name ||
    "";
  const state = get("administrative_area_level_1")?.short_name || "";
  const zip = get("postal_code")?.long_name || "";
  const address = [streetNumber, route].filter(Boolean).join(" ").trim();
  return {
    address,
    city,
    state,
    zip,
    formatted: place?.formatted_address || "",
  };
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
  const [available, setAvailable] = useState<boolean>(false);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const autocompleteSvc = useRef<any>(null);
  const placesSvc = useRef<any>(null);
  const sessionToken = useRef<any>(null);
  const debounceRef = useRef<number | null>(null);
  const skipNextSearch = useRef(false);
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

  const ensureLoaded = useCallback(async () => {
    if (autocompleteSvc.current) return true;
    const g = await loadGoogleMaps();
    if (!g?.maps?.places) {
      setAvailable(false);
      return false;
    }
    autocompleteSvc.current = new g.maps.places.AutocompleteService();
    const stubDiv = document.createElement("div");
    placesSvc.current = new g.maps.places.PlacesService(stubDiv);
    sessionToken.current = new g.maps.places.AutocompleteSessionToken();
    setAvailable(true);
    return true;
  }, []);

  // Kick off SDK load when the field is first focused.
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    void ensureLoaded();
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onBlur?.(e);
  };

  // Debounced predictions fetch.
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (!available || !autocompleteSvc.current) return;
    if (!value || value.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      try {
        autocompleteSvc.current.getPlacePredictions(
          {
            input: value,
            sessionToken: sessionToken.current,
            componentRestrictions:
              countries && countries.length > 0
                ? { country: countries }
                : undefined,
            types: ["address"],
          },
          (preds: any[] | null, status: string) => {
            const g = (window as any).google;
            const ok = g?.maps?.places?.PlacesServiceStatus?.OK;
            if (status === ok && Array.isArray(preds) && preds.length > 0) {
              setPredictions(preds);
              setActiveIdx(-1);
              setOpen(true);
            } else {
              setPredictions([]);
              setOpen(false);
            }
          },
        );
      } catch {
        setPredictions([]);
        setOpen(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, available, countries]);

  const pickPrediction = (p: any) => {
    if (!placesSvc.current || !p?.place_id) {
      setOpen(false);
      return;
    }
    placesSvc.current.getDetails(
      {
        placeId: p.place_id,
        fields: ["address_components", "formatted_address"],
        sessionToken: sessionToken.current,
      },
      (place: any, status: string) => {
        const g = (window as any).google;
        sessionToken.current = new g.maps.places.AutocompleteSessionToken();
        const ok = g?.maps?.places?.PlacesServiceStatus?.OK;
        if (status !== ok || !place) {
          setOpen(false);
          return;
        }
        const parsed = parseAddressComponents(place);
        skipNextSearch.current = true;
        onSelect?.(parsed);
        // If the caller didn't break apart the fields, fall back to street-only.
        if (!onSelect) {
          onChange(parsed.address || parsed.formatted);
        } else {
          onChange(parsed.address || parsed.formatted);
        }
        setPredictions([]);
        setOpen(false);
      },
    );
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
            <li key={p.place_id || idx}>
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
                <div className="font-medium">
                  {p.structured_formatting?.main_text || p.description}
                </div>
                {p.structured_formatting?.secondary_text && (
                  <div className="text-xs text-muted-foreground">
                    {p.structured_formatting.secondary_text}
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
