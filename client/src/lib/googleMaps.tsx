import { MapPin } from "lucide-react";

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
