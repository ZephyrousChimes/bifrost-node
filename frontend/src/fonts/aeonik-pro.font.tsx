import localFont from "next/font/local";

// Same font family as ajna-frontend, carried over as-is.
const aeonikPro = localFont({
  src: [
    { path: "./AeonikPro-Bold.otf", weight: "700", style: "bold" },
    { path: "./AeonikPro-Light.otf", weight: "300", style: "light" },
    { path: "./AeonikPro-Regular.otf", weight: "400", style: "normal" },
  ],
  variable: "--font-aeonik",
});

export default aeonikPro;
