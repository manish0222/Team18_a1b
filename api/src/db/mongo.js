// MongoDB access. The driver connects lazily; if mongod is down, operations
// fail fast (3s) and the error handler turns that into a 503 the UI can show.
import { MongoClient } from 'mongodb';

export function createMongo({ uri, dbName }) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000,
  });
  const db = client.db(dbName);

  return {
    client,
    db: () => db,
    collection: (name) => db.collection(name),
    async ping() {
      await db.command({ ping: 1 });
      return true;
    },
    close: () => client.close(),
  };
}
