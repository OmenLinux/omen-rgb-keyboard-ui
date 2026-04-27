import hpOmenLogoUrl from "../assets/hp-omen-logo.png";

type Props = {
  height?: number;
  className?: string;
};

export function OmenBrandLogo({ height = 22, className }: Props) {
  return (
    <img
      src={hpOmenLogoUrl}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      style={{
        height,
        width: "auto",
        maxWidth: "100%",
        display: "block",
        objectFit: "contain",
      }}
    />
  );
}
