import Image from "next/image";

const LOGO_WIDTH = 196;
const LOGO_LEFT = -((115 / 2172) * LOGO_WIDTH);
const LOGO_HEIGHT = (LOGO_WIDTH * 724) / 2172;
const LOGO_TOP = -((176 / 724) * LOGO_HEIGHT);

export function Logo({
  compact = false,
  priority = false,
}: {
  compact?: boolean;
  priority?: boolean;
}) {
  if (compact) {
    return (
      <Image
        src="/brand/shootportal-icon.png"
        alt="ShootPortal"
        width={32}
        height={32}
        priority={priority}
        className="h-8 w-8"
      />
    );
  }

  return (
    <span className="relative block h-8 w-44 overflow-hidden">
      <Image
        src="/brand/shootportal-logo.png"
        alt="ShootPortal"
        width={2172}
        height={724}
        priority={priority}
        className="absolute max-w-none"
        style={{
          width: LOGO_WIDTH,
          height: LOGO_HEIGHT,
          left: LOGO_LEFT,
          top: LOGO_TOP,
        }}
      />
    </span>
  );
}
