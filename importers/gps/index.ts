import type { GpsImporter } from "./schema";
import googleTimeline from "./google-timeline";
import googleRecords from "./google-records";
import gpx from "./gpx";
import fixes from "./fixes";

/**
 * Every position importer, in one list — and the list is why this file exists
 * rather than a directory scan.
 *
 * B665 discovered importers with `fs.readdirSync` and a dynamic `import()`,
 * which is the nicer story ("the folder is the registry") and works only in a
 * process that can see the folder. The importers are reached from an API route
 * now (B671), and a bundler cannot trace a path it is handed at runtime: the
 * files would simply be missing from a production build, and the failure would
 * be "no importer recognised your export" on the deployed instance and nowhere
 * else.
 *
 * So: adding an importer is a file **and this line**. `test/gps-importers.
 * test.ts` walks the folder and fails when a file is not listed here, naming
 * the line to add — which is the drop-in promise kept by a test rather than by
 * a runtime scan.
 *
 * Order is the order `detect` is tried in. Put a stricter format above a
 * looser one.
 */
export const GPS_IMPORTERS: GpsImporter[] = [googleTimeline, googleRecords, gpx, fixes];

/** The ids, for the API's own listing and for `/openapi.json`'s enum — the
 * document imports this rather than restating it (AGENTS.md). */
export const GPS_FORMATS = GPS_IMPORTERS.map((i) => i.id);
