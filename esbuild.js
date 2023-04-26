import dotenv from "dotenv"
import esbuild from "esbuild"

dotenv.config();

// Taken from internet recommendation on getting an esbuild https://medium.com/geekculture/build-a-library-with-esbuild-23235712f3c
// Will we actually need to build this? TBD
esbuild
    .build({
        entryPoints: ["src/index.js"],
        outdir: "lib",
        bundle: true,
        sourcemap: true,
        minify: true,
        splitting: true,
        format: "esm",
        target: ["esnext"]
    })
    .catch(() => process.exit(1));
