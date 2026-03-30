from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


# ── OpenF1 Live Timing ────────────────────────────────────────────────────────

class CarData(BaseModel):
    date: Optional[datetime] = None
    driver_number: int
    rpm: Optional[int] = None
    speed: Optional[int] = None
    n_gear: Optional[int] = None
    throttle: Optional[int] = None
    brake: Optional[int] = None
    drs: Optional[int] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Position(BaseModel):
    date: Optional[datetime] = None
    driver_number: int
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Interval(BaseModel):
    date: Optional[datetime] = None
    driver_number: int
    gap_to_leader: Optional[str] = None
    interval: Optional[str] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Stint(BaseModel):
    driver_number: int
    stint_number: Optional[int] = None
    lap_start: Optional[int] = None
    lap_end: Optional[int] = None
    compound: Optional[str] = None
    tyre_age_at_start: Optional[int] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Pit(BaseModel):
    date: Optional[datetime] = None
    driver_number: int
    lap_number: Optional[int] = None
    pit_duration: Optional[float] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Driver(BaseModel):
    driver_number: int
    broadcast_name: Optional[str] = None
    full_name: Optional[str] = None
    name_acronym: Optional[str] = None
    team_name: Optional[str] = None
    team_colour: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    headshot_url: Optional[str] = None
    country_code: Optional[str] = None
    session_key: Optional[int] = None
    meeting_key: Optional[int] = None


class LapTiming(BaseModel):
    date_start: Optional[datetime] = None
    driver_number: int
    lap_number: Optional[int] = None
    lap_duration: Optional[float] = None
    duration_sector_1: Optional[float] = None
    duration_sector_2: Optional[float] = None
    duration_sector_3: Optional[float] = None
    i1_speed: Optional[int] = None
    i2_speed: Optional[int] = None
    st_speed: Optional[int] = None
    is_pit_out_lap: Optional[bool] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class RaceControl(BaseModel):
    date: Optional[datetime] = None
    driver_number: Optional[int] = None
    lap_number: Optional[int] = None
    category: Optional[str] = None
    flag: Optional[str] = None
    scope: Optional[str] = None
    sector: Optional[int] = None
    message: Optional[str] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class WeatherData(BaseModel):
    date: Optional[datetime] = None
    air_temperature: Optional[float] = None
    humidity: Optional[float] = None
    pressure: Optional[float] = None
    rainfall: Optional[int] = None
    track_temperature: Optional[float] = None
    wind_direction: Optional[int] = None
    wind_speed: Optional[float] = None
    meeting_key: Optional[int] = None
    session_key: Optional[int] = None


class Session(BaseModel):
    session_key: int
    session_name: Optional[str] = None
    session_type: Optional[str] = None
    status: Optional[str] = None
    date_start: Optional[datetime] = None
    date_end: Optional[datetime] = None
    circuit_key: Optional[int] = None
    circuit_short_name: Optional[str] = None
    country_code: Optional[str] = None
    country_name: Optional[str] = None
    location: Optional[str] = None
    year: Optional[int] = None
    meeting_key: Optional[int] = None


class Meeting(BaseModel):
    meeting_key: int
    meeting_name: Optional[str] = None
    meeting_official_name: Optional[str] = None
    location: Optional[str] = None
    country_code: Optional[str] = None
    country_name: Optional[str] = None
    circuit_key: Optional[int] = None
    circuit_short_name: Optional[str] = None
    date_start: Optional[datetime] = None
    year: Optional[int] = None


# ── Ergast Historical ─────────────────────────────────────────────────────────

class ErgastDriver(BaseModel):
    driver_id: str
    permanent_number: Optional[str] = None
    code: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    nationality: Optional[str] = None


class ErgastConstructor(BaseModel):
    constructor_id: str
    name: Optional[str] = None
    nationality: Optional[str] = None


class ErgastRaceResult(BaseModel):
    season: Optional[str] = None
    round: Optional[str] = None
    race_name: Optional[str] = None
    circuit_name: Optional[str] = None
    date: Optional[str] = None
    driver: Optional[ErgastDriver] = None
    constructor: Optional[ErgastConstructor] = None
    grid: Optional[str] = None
    laps: Optional[str] = None
    status: Optional[str] = None
    position: Optional[str] = None
    points: Optional[str] = None
    fastest_lap_time: Optional[str] = None


class DriverStanding(BaseModel):
    position: Optional[str] = None
    points: Optional[str] = None
    wins: Optional[str] = None
    driver: Optional[ErgastDriver] = None
    constructor: Optional[ErgastConstructor] = None


class ConstructorStanding(BaseModel):
    position: Optional[str] = None
    points: Optional[str] = None
    wins: Optional[str] = None
    constructor: Optional[ErgastConstructor] = None


class QualifyingResult(BaseModel):
    driver: Optional[ErgastDriver] = None
    constructor: Optional[ErgastConstructor] = None
    position: Optional[str] = None
    q1: Optional[str] = None
    q2: Optional[str] = None
    q3: Optional[str] = None


# ── FastF1 Telemetry ──────────────────────────────────────────────────────────

class TelemetryPoint(BaseModel):
    time_ms: float
    speed: Optional[float] = None
    rpm: Optional[float] = None
    gear: Optional[int] = None
    throttle: Optional[float] = None
    brake: Optional[float] = None
    drs: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None


class LapTelemetry(BaseModel):
    driver: str
    lap_number: int
    lap_time: Optional[str] = None
    compound: Optional[str] = None
    tyre_life: Optional[int] = None
    is_personal_best: Optional[bool] = None
    telemetry: List[TelemetryPoint] = []


class SessionTelemetrySummary(BaseModel):
    session: str
    year: int
    event: str
    laps: List[LapTelemetry] = []


# ── AI Predictions ────────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    session_key: int
    driver_numbers: Optional[List[int]] = None
    context: Optional[str] = None


class StrategyRecommendation(BaseModel):
    driver_number: int
    driver_name: Optional[str] = None
    current_compound: Optional[str] = None
    laps_on_tyre: Optional[int] = None
    recommended_stop_lap: Optional[int] = None
    recommended_compound: Optional[str] = None
    reasoning: str


class RacePrediction(BaseModel):
    session_key: int
    predicted_winner: Optional[str] = None
    podium: List[str] = []
    safety_car_probability: Optional[float] = None
    strategy_recommendations: List[StrategyRecommendation] = []
    key_insights: List[str] = []
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class AIInsightRequest(BaseModel):
    prompt: str
    session_key: Optional[int] = None
    context_data: Optional[dict] = None


class AIInsightResponse(BaseModel):
    insight: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
