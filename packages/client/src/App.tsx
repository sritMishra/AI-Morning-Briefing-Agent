import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getHealth, runBriefNow } from './api/client.js';

/**
 * Phase-1 dashboard. "Run brief now" fires the same pipeline as the 10:15
 * scheduler and renders the analysed brief (Section 1: changed in 24h,
 * Section 2: board table). Without an LLM key it falls back to a raw list.
 */
export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const run = useMutation({ mutationFn: runBriefNow });
  const result = run.data;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        ☀️ Morning Briefing
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Tool analyser · Jira , Slack &amp; Gmail coming
      </Typography>

      <Stack spacing={3} sx={{ mt: 3 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="contained" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? 'Running…' : 'Run brief now'}
            </Button>
            {health.data && <Chip color="success" size="small" label="server online" />}
            {health.isError && <Chip color="error" size="small" label="server offline" />}
          </Stack>

          {result && (
            <Box sx={{ mt: 2 }}>
              <Alert severity={result.status === 'failed' ? 'error' : 'success'}>
                Run {result.status} · {result.itemCount} changed by others
                {result.errors.length > 0 && ` · errors: ${result.errors.join('; ')}`}
              </Alert>
            </Box>
          )}
          {run.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Request failed: {String(run.error)}
            </Alert>
          )}
        </Paper>

        {result?.rendered && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Subject: {result.rendered.subject}
            </Typography>
            <Box
              sx={{ mt: 1 }}
              // Content is produced + HTML-escaped by our own renderer.
              dangerouslySetInnerHTML={{ __html: result.rendered.html }}
            />
          </Paper>
        )}

        {result && !result.rendered && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Changed by others (raw — no LLM key configured)
            </Typography>
            {result.preview && result.preview.length > 0 ? (
              <List dense>
                {result.preview.map((it) => (
                  <ListItem key={it.title}>
                    <Typography variant="body2">{it.title}</Typography>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography color="text.secondary">Nothing changed by others in the window.</Typography>
            )}
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
