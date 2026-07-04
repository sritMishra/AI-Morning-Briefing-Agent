# Morning Briefing Analyser

## What this is

A scheduled read-only AI analyser that runs every morning at 10:15 AM.
It connects to Slack and Jira, reads everything relevant, understands
context from past activity, and delivers a prioritised morning brief
via email and Slack DM — before I open my laptop at 11 AM.

**This is NOT an agent that takes action.**
It is a read-only analyser and recommender.
It never replies to anyone, never posts to channels, never modifies
any ticket or message. It only reads, analyses, and reports to me.

---

## The problem it solves

Every morning I spend 45 minutes manually:
- Scanning Slack for messages where I am tagged or channels I follow
- Reading Jira ticket updates and understanding what changed overnight
- Mentally building a plan of action for the day

This tool does all of that before I wake up and delivers a ready brief
so I start work immediately with full context — not 45 minutes later.

---

## Data sources (read-only, in priority order)

### 1. Slack (highest priority)
- All messages and threads where I am directly @mentioned
- All messages in my key project channels (configured in .env)
- Filter out: broadcast tags (@here, @channel) unless the message
  content is directly relevant to my work or tickets
- Look back: last 24 hours (or since last brief was generated)

### 2. Jira (highest priority)
- All tickets currently assigned to me — any status changes, comments,
  new attachments, or linked tickets added in the last 24 hours
- Any tickets where I am mentioned in a comment
- Any new tickets assigned to me since yesterday's brief
- Sprint board status — what's due soon, what's blocked
- Look back: last 24 hours + full history of active tickets for context

### 3. Email (secondary — future phase)
- Jira notification emails (already covered by direct Jira API above,
  so email is low priority and can be skipped in Phase 1)
- Flag for Phase 2 after Slack + Jira are working

### 4. Microsoft Teams (future phase)
- Client-side communication channel
- Read-only, same pattern as Slack
- Add in Phase 3 once core is stable

---

## What the analyser should understand

### Context awareness — not just today, but history
For each active Jira ticket, the analyser must understand:
- What was the original requirement
- What has been discussed in comments over the past week
- What decision was made last (if any)
- What is the current blocker or open question
- What changed in the last 24 hours

For each Slack thread, it must understand:
- What was the original question or discussion
- What is the current state of that thread
- Whether it needs my input or is just informational

### Relevance filtering for Slack
Many Slack messages tag me but are not relevant (broadcast tags,
general announcements, noise). The analyser should:
- HIGH priority: direct @mention with a question or action for me
- MEDIUM priority: thread I previously participated in has new activity
- LOW / SKIP: @here or @channel broadcasts with no specific action for me
- Always tell me it filtered something out so I can verify if needed

### Recommendations — not just summaries
For each item surfaced, the analyser should suggest:
- What action I likely need to take (if any)
- Whether it is urgent (needs attention today) or can wait
- If a Jira ticket is blocked, what information is missing
- If a Slack thread needs my reply, what the key point to address is

The recommendation is a suggestion only. I make the final call.
I will still check Slack myself — the brief is a head start, not a replacement.

---

## Output format — the morning brief

Delivered via: **email to my inbox + Slack DM from the bot**
Delivered at: **10:15 AM daily (before I start at 11 AM)**

### Structure of the brief

```
MORNING BRIEF — [Day, Date]
Generated at 10:15 AM

─────────────────────────────
🔴 URGENT — Needs attention today
─────────────────────────────
[Item 1]
Source: Slack / #channel-name
What happened: [1-2 sentence summary]
Recommended action: [specific suggestion]
Link: [direct link]

[Item 2] ...

─────────────────────────────
🟡 IMPORTANT — Review today
─────────────────────────────
[Jira ticket or Slack thread summary]
What changed: [what is new since yesterday]
Context: [brief history so I don't need to re-read everything]
Recommended action: [suggestion]
Link: [direct link]

─────────────────────────────
🟢 FYI — No action needed
─────────────────────────────
- [Brief one-liner for informational items]
- [Filtered Slack broadcasts — listed so I know they were seen]

─────────────────────────────
📋 TODAY'S JIRA BOARD
─────────────────────────────
In Progress:  [ticket list with status]
Blocked:      [ticket list with blocker reason]
Due Soon:     [tickets due in next 2 days]
New Today:    [any newly assigned tickets]

─────────────────────────────
💡 RECOMMENDATIONS
─────────────────────────────
Suggested priority order for today based on urgency + dependencies:
1. [Task / ticket]  — reason
2. [Task / ticket]  — reason
3. [Task / ticket]  — reason
```
