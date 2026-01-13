import path from "node:path";
import process from "node:process";
import Persistence from "./Persistence.js";

function main() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  // eslint-disable-next-line no-new
  new Persistence({ ensureSchema: true, schemaPath });
  // eslint-disable-next-line no-console
  console.log("Javaspectre catalog schema ensured at javaspectre-catalog.sqlite3");
}

main();
