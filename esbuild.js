import * as esbuild from 'esbuild';
import { promises as fs } from "fs";
import express from 'express';
import path from 'path';
import cors from 'cors';

const esbuildSharedOptions = {
  bundle: true,
  write: false,
  outdir: 'out',
  packages: 'external',
  platform: 'node',
  format: 'iife',
}

async function processRepository(ctx, repositoryPath) {
  // Check and create the dist directory if it doesn't exist
  const distDir = `${repositoryPath}/../dist`;
  try {
    await fs.access(distDir);
  } catch {
    await fs.mkdir(distDir, { recursive: true });
  }

  // TODO: add multiple possible entry points
  let result = await ctx.rebuild({
    entryPoints: [`${repositoryPath}/plugin.js`],
    bundle: true,
    write: false, // Don't write to disk, return in outputFiles instead
    outdir: 'out',
    packages: 'external',
    platform: 'node',
    format: 'iife',
  });

  for (let out of result.outputFiles) {
    // Append "return plugin;" at the end of the generated iife, before the closing brackets
    let result = out.text.replace(/^}\)\(\);$/gm, "  return plugin;\n})()");
    // Remove any lines attempting to import module using the esbuild __require
    result = result.replace(/^\s+var import_.+= (?:__toESM\()?__require\(".+"\).*;/gm, "");
    const outputFile = `${distDir}/out.plugin.js`;
    console.log('File has been written successfully');
    return fs.writeFile(outputFile, result);
  }
}

async function startServer(ctx, repositoryPath) {
  const app = express();
  const port = 3000;

  app.use(cors());

  // Endpoint to provide the file contents
  app.get('/code', async (req, res) => {
    const result = await processRepository(ctx, repositoryPath);
    res.sendFile(path.resolve(`${repositoryPath}/../dist/out.plugin.js`));

  });

  let server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
  });
  server.on('close', () => {
    console.log('Server has stopped');
    ctx.dispose();
  });
}

async function main() {
  const repositoryPath = process.argv[2];
  if (!repositoryPath) {
    console.error('Please provide the path of the repository as a command-line argument.');
    process.exit(1);
  }

  let opts = esbuildSharedOptions;
  opts.entryPoints = [`${repositoryPath}/plugin.js`];
  let ctx = await esbuild.context(opts);
  if (process.argv.includes('--server')) {
    await startServer(ctx, repositoryPath);
  } else {
    await processRepository(ctx, repositoryPath);
    ctx.dispose()
  }
}

main().then(() => {
  console.log("Finished execution");
}
).catch(() => {
  console.log("error");
})