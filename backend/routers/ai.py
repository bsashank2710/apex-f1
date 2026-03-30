"""
AI prediction and insight endpoints — powered by Anthropic Claude.
Fetches live race context from OpenF1 then sends it to Claude for analysis.
"""

import os
import asyncio
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from dotenv import load_dotenv
import anthropic

from models.schemas import (
    PredictionRequest,
    RacePrediction,
    AIInsightRequest,
    AIInsightResponse,
    StrategyRecommendation,
)
from services import openf1

load_dotenv()

router = APIRouter(prefix="/ai", tags=["ai"])

# 3.5 snapshot IDs often 404 on current Anthropic accounts; Sonnet 4 is the stable default.
CLAUDE_MODEL = "claude-sonnet-4-20250514"


def resolve_anthropic_api_key(request: Request) -> str:
    """
    Prefer server env (safe for production). If unset, use X-Anthropic-Key from the app so
    EXPO_PUBLIC_ANTHROPIC_API_KEY works against Cloud Run without GCP console setup.
    Note: keys in the client bundle are visible to anyone — fine for personal use only.
    """
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if key:
        return key
    forwarded = (request.headers.get("X-Anthropic-Key") or "").strip()
    if forwarded:
        return forwarded
    raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")


def get_anthropic_client(request: Request) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=resolve_anthropic_api_key(request))


AnthropicClient = Annotated[anthropic.AsyncAnthropic, Depends(get_anthropic_client)]


async def _build_race_context(session_key: int | str) -> dict:
    """Gather live race data to feed as context to Claude."""
    drivers, intervals, stints, laps, rc, weather = await asyncio.gather(
        openf1.get_drivers(session_key=session_key),
        openf1.get_intervals(session_key=session_key),
        openf1.get_stints(session_key=session_key),
        openf1.get_laps(session_key=session_key),
        openf1.get_race_control(session_key=session_key),
        openf1.get_weather(session_key=session_key),
        return_exceptions=True,
    )

    def safe(val):
        return val if not isinstance(val, Exception) else []

    return {
        "drivers": safe(drivers),
        "intervals": safe(intervals),
        "stints": safe(stints),
        "laps": safe(laps)[-60:],   # last 60 lap records
        "race_control": safe(rc)[-10:],
        "weather": safe(weather)[-3:],
    }


def _format_context_for_prompt(ctx: dict) -> str:
    import json
    return json.dumps(ctx, indent=2, default=str)


# ── Race Prediction ───────────────────────────────────────────────────────────

@router.post("/predict", response_model=RacePrediction)
async def predict_race_outcome(body: PredictionRequest, client: AnthropicClient):
    """
    Use Claude to predict race outcome, strategy calls, and key insights
    based on live timing data from OpenF1.
    """
    ctx = await _build_race_context(body.session_key)
    ctx_str = _format_context_for_prompt(ctx)

    driver_filter = ""
    if body.driver_numbers:
        driver_filter = f"Focus especially on driver numbers: {body.driver_numbers}."

    user_context = f"\nAdditional context: {body.context}" if body.context else ""

    prompt = f"""You are an elite F1 race strategist and data analyst with deep knowledge of Formula 1.
Analyze the following live race data and provide strategic predictions.

{driver_filter}{user_context}

LIVE RACE DATA:
{ctx_str}

Respond in valid JSON with this exact structure:
{{
  "predicted_winner": "driver name or acronym",
  "podium": ["P1 driver", "P2 driver", "P3 driver"],
  "safety_car_probability": 0.0 to 1.0,
  "strategy_recommendations": [
    {{
      "driver_number": 1,
      "driver_name": "Max Verstappen",
      "current_compound": "MEDIUM",
      "laps_on_tyre": 15,
      "recommended_stop_lap": 35,
      "recommended_compound": "SOFT",
      "reasoning": "..."
    }}
  ],
  "key_insights": [
    "insight 1",
    "insight 2",
    "insight 3"
  ]
}}

Base your analysis on tyre degradation, gaps, weather, and historical pace data.
Be specific and data-driven. Return ONLY valid JSON."""

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    import json
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Claude returned invalid JSON: {e}")

    return RacePrediction(
        session_key=body.session_key,
        predicted_winner=parsed.get("predicted_winner"),
        podium=parsed.get("podium", []),
        safety_car_probability=parsed.get("safety_car_probability"),
        strategy_recommendations=[
            StrategyRecommendation(**r) for r in parsed.get("strategy_recommendations", [])
        ],
        key_insights=parsed.get("key_insights", []),
        generated_at=datetime.utcnow(),
    )


# ── Tyre Strategy Advisor ─────────────────────────────────────────────────────

@router.get("/strategy/{session_key}")
async def strategy_advisor(
    client: AnthropicClient,
    session_key: str = "latest",
    driver_number: Optional[int] = Query(None),
):
    """
    Real-time tyre strategy recommendations for all (or a specific) driver.
    """

    stints, laps, weather, drivers = await asyncio.gather(
        openf1.get_stints(session_key=session_key, driver_number=driver_number),
        openf1.get_laps(session_key=session_key, driver_number=driver_number),
        openf1.get_weather(session_key=session_key),
        openf1.get_drivers(session_key=session_key, driver_number=driver_number),
    )

    import json
    ctx_str = json.dumps({
        "stints": stints,
        "recent_laps": laps[-40:],
        "weather": weather[-2:],
        "drivers": drivers,
    }, default=str, indent=2)

    prompt = f"""You are an F1 tyre strategy expert. Given the following data, provide specific
pit stop and compound recommendations for each driver.

DATA:
{ctx_str}

Respond in JSON array format:
[
  {{
    "driver_number": 1,
    "driver_name": "...",
    "current_compound": "SOFT|MEDIUM|HARD|INTERMEDIATE|WET",
    "laps_on_tyre": 0,
    "recommended_stop_lap": 0,
    "recommended_compound": "...",
    "reasoning": "brief explanation"
  }}
]

Return ONLY the JSON array."""

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    import json
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = []

    return {"session_key": session_key, "recommendations": parsed}


# ── Free-form Race Insight ────────────────────────────────────────────────────

@router.post("/insight", response_model=AIInsightResponse)
async def race_insight(body: AIInsightRequest, client: AnthropicClient):
    """
    Ask Claude anything about the race. Optionally attach live session context.
    Used by the AI Predictions screen's chat-style interface.
    """

    context_block = ""
    if body.session_key:
        ctx = await _build_race_context(body.session_key)
        import json
        context_block = f"\n\nLIVE RACE CONTEXT:\n{json.dumps(ctx, default=str, indent=2)}"

    if body.context_data:
        import json
        context_block += f"\n\nADDITIONAL DATA:\n{json.dumps(body.context_data, default=str)}"

    prompt = f"""You are APEX, an AI race intelligence system for Formula 1.
Answer the following question concisely and expertly.{context_block}

QUESTION: {body.prompt}"""

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )

    return AIInsightResponse(insight=message.content[0].text.strip())


# ── Post-Race Intelligence ────────────────────────────────────────────────────

def _intel_json_schema_block() -> str:
    """Shared Claude output shape for race / sprint / qualifying intel."""
    return """{
  "headline": "Punchy headline under 10 words",
  "summary": "2-3 sentence expert narrative naming specific drivers and data points.",
  "driver_analysis": [
    {
      "driver_code": "VER",
      "driver_name": "Max Verstappen",
      "grid": 1,
      "finish": 1,
      "score": 88,
      "highlights": ["Specific positive with data"],
      "mistakes": ["Specific mistake or empty list if flawless"],
      "tip": "One concrete data-driven improvement tip for this driver"
    }
  ],
  "strategy_verdict": {
    "best_team": "Team name",
    "worst_team": "Team name",
    "key_insight": "The single biggest lesson from this session",
    "pit_analysis": "Relevant analysis (or state N/A for qualifying-only)"
  },
  "what_ifs": [
    "What if ...",
    "What if ...",
    "What if ..."
  ],
  "championship_impact": "Points / grid implications where applicable.",
  "race_grade": "S",
  "grade_reason": "One sentence explaining the grade"
}"""


def _rows_race_like(results: list[dict]) -> list[dict]:
    return [
        {
            "pos": r.get("position"),
            "driver": r.get("Driver", {}).get("code"),
            "name": f"{r.get('Driver', {}).get('givenName', '')} {r.get('Driver', {}).get('familyName', '')}".strip(),
            "team": r.get("Constructor", {}).get("name"),
            "grid": r.get("grid"),
            "laps": r.get("laps"),
            "status": r.get("status"),
            "points": r.get("points"),
            "fastest_lap": r.get("FastestLap", {}).get("Time", {}).get("time"),
            "race_time": r.get("Time", {}).get("time"),
        }
        for r in results
    ]


def _rows_qualifying(qualifying: list[dict]) -> list[dict]:
    return [
        {
            "pos": q.get("position"),
            "driver": q.get("Driver", {}).get("code"),
            "name": f"{q.get('Driver', {}).get('givenName', '')} {q.get('Driver', {}).get('familyName', '')}".strip(),
            "team": q.get("Constructor", {}).get("name"),
            "Q1": q.get("Q1"),
            "Q2": q.get("Q2"),
            "Q3": q.get("Q3"),
        }
        for q in qualifying
    ]


@router.get("/post_race_intel/{year}/{round_num}")
async def post_race_intel(
    client: AnthropicClient,
    year: str = Path(..., description="Season year e.g. 2026"),
    round_num: str = Path(..., description="Race round number e.g. 3"),
):
    """
    AI-powered analysis: prefers Grand Prix results, then sprint, then qualifying
    if the race has not finished yet.
    """

    from services import ergast as _ergast
    import json

    results, qualifying, sprint, pitstops = await asyncio.gather(
        _ergast.get_race_results(year=year, round_=round_num),
        _ergast.get_qualifying_results(year=year, round_=round_num),
        _ergast.get_sprint_results(year=year, round_=round_num),
        _ergast.get_pit_stops(year=year, round_=round_num),
        return_exceptions=True,
    )

    def safe(v):
        return v if not isinstance(v, Exception) else []

    results, qualifying, sprint, pitstops = (
        safe(results),
        safe(qualifying),
        safe(sprint),
        safe(pitstops),
    )

    if results:
        intel_basis = "race"
        session_focus = "Grand Prix"
        ctx = {
            "session": "Grand Prix race — full results",
            "results": _rows_race_like(results),
            "qualifying": _rows_qualifying(qualifying),
            "pit_stops": [
                {
                    "driver": p.get("driverId"),
                    "stop": p.get("stop"),
                    "lap": p.get("lap"),
                    "duration": p.get("duration"),
                }
                for p in pitstops
            ],
        }
        intro = """You are APEX, an elite Formula 1 race intelligence system.
Analyze this completed F1 GRAND PRIX and deliver expert post-race intelligence."""
        rules = """Rules:
- Include ALL drivers who scored points in driver_analysis (minimum top 10)
- score is 0-100: pace + race craft + strategy combined
- Be specific: lap numbers, time deltas, position changes where data supports it
- Return ONLY valid JSON"""
    elif sprint:
        intel_basis = "sprint"
        session_focus = "Sprint"
        ctx = {
            "session": "Sprint race — Grand Prix not finished yet; sprint results only",
            "sprint_results": _rows_race_like(sprint),
            "qualifying": _rows_qualifying(qualifying),
            "pit_stops": [],
        }
        intro = """You are APEX, an elite Formula 1 race intelligence system.
The main Grand Prix for this round is not in the database yet. Analyze the SPRINT session only.
Frame headline and summary as sprint-focused; mention the full race is still to come where natural."""
        rules = """Rules:
- driver_analysis: use sprint grid and sprint finish positions from the data
- Include all sprint points scorers (typically top 8) plus notable others, minimum 10 drivers if data exists
- score 0-100 for sprint performance (launch, overtakes, tyre use in sprint)
- pit_analysis: sprint pit stops are rare — say so briefly if none in data
- championship_impact: sprint points and grid narrative for Sunday where relevant
- Return ONLY valid JSON"""
    elif qualifying:
        intel_basis = "qualifying"
        session_focus = "Qualifying"
        ctx = {
            "session": "Qualifying only — no sprint or race results published yet",
            "qualifying": _rows_qualifying(qualifying),
        }
        intro = """You are APEX, an elite Formula 1 race intelligence system.
Only QUALIFYING results exist for this round (no sprint or race in the database yet).
Deliver sharp qualifying intel: session progression (Q1→Q2→Q3), surprises, team form, and grid implications for the upcoming race."""
        rules = """Rules:
- driver_analysis: set both grid and finish to the final qualifying position (same number) for each driver — the UI shows Pn→Pn; use highlights/mistakes/tip for Q1/Q2/Q3 story
- Include at least top 15 qualifiers (all Q3 participants + notable Q2 exits if interesting)
- score 0-100: quali execution (pace, segment progression, errors)
- strategy_verdict: interpret as qualifying execution (who nailed / who missed setup)
- pit_analysis: one short sentence that pit stops do not apply to qualifying
- what_ifs: qualifying-focused (track evolution, deleted laps, weather what-ifs)
- championship_impact: starting grid implications and narrative; note race not run yet
- Return ONLY valid JSON"""
    else:
        raise HTTPException(
            status_code=404,
            detail="No session data for this round (no qualifying, sprint, or race results in the database yet)",
        )

    ctx_str = json.dumps(ctx, indent=2)
    schema = _intel_json_schema_block()
    prompt = f"""{intro}

SESSION DATA (JSON):
{ctx_str}

Respond with EXACTLY this JSON structure (no extra keys, no markdown):
{schema}

{rules}"""

    try:
        message = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=3500,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as e:
        detail = getattr(e, "message", None) or str(e)
        raise HTTPException(
            status_code=502,
            detail=f"Claude API error (check model access & billing): {detail}",
        ) from e

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Claude returned invalid JSON: {e}")

    parsed["year"] = year
    parsed["round"] = round_num
    parsed["intel_basis"] = intel_basis
    parsed["session_focus"] = session_focus
    parsed["generated_at"] = datetime.utcnow().isoformat()
    return parsed


# ── Safety Car Probability ────────────────────────────────────────────────────

@router.get("/safety_car/{session_key}")
async def safety_car_probability(client: AnthropicClient, session_key: str = "latest"):
    """
    Estimate the probability of a safety car in the remaining laps based on
    race control messages, weather, and historical data.
    """

    rc, weather = await asyncio.gather(
        openf1.get_race_control(session_key=session_key),
        openf1.get_weather(session_key=session_key),
    )

    import json
    ctx_str = json.dumps({"race_control": rc[-20:], "weather": weather[-3:]}, default=str)

    prompt = f"""Based on this F1 race control data and weather, estimate the probability
of a safety car or VSC in the next 10 laps. Return JSON: {{"probability": 0.0, "reasoning": "..."}}

DATA: {ctx_str}

Return ONLY JSON."""

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()

    import json
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"probability": None, "reasoning": raw}

    return {"session_key": session_key, **result}
