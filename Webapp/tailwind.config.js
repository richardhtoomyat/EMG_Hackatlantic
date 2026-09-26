/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0D1014",
        surface: "#161A20",
        deep: "#11151A",
        line: "#262C35",
        track: "#1E232B",
        ink: "#ECEAE4",
        muted: "#9AA0A8",
        soft: "#C4C7CC",
        accent: "#7FB8C9",
        work: "#D9B26A",
        max: "#E07A5F",
        // body map palette (light card)
        mapcard: "#FAFAFA",
        primaryMuscle: "#C8202F",
        secondaryMuscle: "#F0B429",
        untargetedMuscle: "#D8D8D8",
      },
      fontFamily: {
        serif: ["Newsreader", "Georgia", "serif"],
        sans: ["Manrope", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
