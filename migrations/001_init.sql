CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  api_key_hash  text NOT NULL UNIQUE,
  notify_email  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE widgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('signup', 'contact')),
  title        text NOT NULL,
  description  text,
  fields       jsonb NOT NULL,
  button_text  text NOT NULL,
  display      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX widgets_tenant_idx ON widgets (tenant_id);

CREATE TABLE submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id        uuid NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data             jsonb NOT NULL,
  country          text,
  city             text,
  geo_provider     text,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (widget_id, idempotency_key)
);
CREATE INDEX submissions_tenant_created_idx ON submissions (tenant_id, created_at DESC);
CREATE INDEX submissions_widget_created_idx ON submissions (widget_id, created_at DESC);

CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  run_at        timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE status = 'pending';
