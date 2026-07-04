import { Alert, Box, Button, Chip, Container, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getHealth, runBriefNow } from './api/client.js';

/**
 * Phase-1 dashboard shell. Two jobs for now:
 *   1. show whether the server/scheduler is up
 *   2. let me trigger a briefing run on demand (instead of waiting for 10:15)
 * The brief itself is delivered by email + Slack DM; a rendered preview here
 * comes once the pipeline produces structured output.
 */
export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const run = useMutation({ mutationFn: runBriefNow });

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        ☀️ Morning Briefing
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Read-only analyser · Slack · Jira · Gmail
      </Typography>

      <Stack spacing={3} sx={{ mt: 3 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Server status
          </Typography>
          {health.isLoading && <Typography>Checking…</Typography>}
          {health.isError && <Alert severity="error">Server unreachable</Alert>}
          {health.data && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip color="success" label="Online" />
              <Typography color="text.secondary">{health.data.service}</Typography>
            </Stack>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Run a brief now
          </Typography>
          <Button
            variant="contained"
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.isPending ? 'Running…' : 'Run brief'}
          </Button>
          {run.data && (
            <Box sx={{ mt: 2 }}>
              <Alert severity={run.data.status === 'failed' ? 'error' : 'success'}>
                Status: {run.data.status} · items: {run.data.itemCount}
                {run.data.errors.length > 0 && ` · errors: ${run.data.errors.join('; ')}`}
              </Alert>
            </Box>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
