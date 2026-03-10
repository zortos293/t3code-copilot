import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const DEFAULT_EXECUTION_ENVIRONMENT = "host";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE provider_session_runtime
    ADD COLUMN execution_environment TEXT NOT NULL DEFAULT 'host'
  `;

  yield* sql`
    UPDATE provider_session_runtime
    SET execution_environment = ${DEFAULT_EXECUTION_ENVIRONMENT}
    WHERE execution_environment IS NULL
  `;

  yield* sql`
    ALTER TABLE projection_thread_sessions
    ADD COLUMN execution_environment TEXT NOT NULL DEFAULT 'host'
  `;

  yield* sql`
    UPDATE projection_thread_sessions
    SET execution_environment = ${DEFAULT_EXECUTION_ENVIRONMENT}
    WHERE execution_environment IS NULL
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN execution_environment TEXT NOT NULL DEFAULT 'host'
  `;

  yield* sql`
    UPDATE projection_threads
    SET execution_environment = ${DEFAULT_EXECUTION_ENVIRONMENT}
    WHERE execution_environment IS NULL
  `;
});
