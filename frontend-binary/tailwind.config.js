/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        polymarket: {
          green: "#00c853",
          red: "#ff1744",
          blue: "#2962ff",
          bg: "#0d0d0d",
          card: "#1a1a1a",
          border: "#2a2a2a",
        },
      },
    },
  },
  plugins: [],
};
