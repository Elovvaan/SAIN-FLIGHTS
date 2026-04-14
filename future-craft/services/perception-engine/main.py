import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import nats
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

load_dotenv()

NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
VEHICLE_ID = os.getenv("VEHICLE_ID", "sain-001")
PERCEPTION_HTTP_PORT = int(os.getenv("PERCEPTION_HTTP_PORT", "8010"))
TOPIC_SCENE_UPDATED = "vehicle.scene.updated"

app = FastAPI(title="Sain Flight Perception Engine", version="0.1.0")

nc: Optional[nats.NATS] = None


class SceneState(BaseModel):
    vehicleId: str
    obstaclesDetected: int
    clearanceM: float
    targetVisible: bool
    targetDistanceM: Optional[float]
    confidence: float
    source: str
    timestamp: str


def build_mock_scene() -> SceneState:
    return SceneState(
        vehicleId=VEHICLE_ID,
        obstaclesDetected=0,
        clearanceM=12.5,
        targetVisible=True,
        targetDistanceM=8.2,
        confidence=0.91,
        source="sim-perception",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "perception-engine"}


@app.get("/scene", response_model=SceneState)
def get_scene():
    return build_mock_scene()


@app.on_event("startup")
async def startup_event():
    global nc
    nc = await nats.connect(NATS_URL)
    print(f"[perception-engine] Connected to NATS at {NATS_URL}")
    asyncio.create_task(publish_scene_loop())


@app.on_event("shutdown")
async def shutdown_event():
    if nc:
        await nc.drain()


async def publish_scene_loop():
    while True:
        try:
            scene = build_mock_scene()
            payload = scene.model_dump_json().encode()
            await nc.publish(TOPIC_SCENE_UPDATED, payload)
            print(f"[perception-engine] Published scene state")
        except Exception as e:
            print(f"[perception-engine] Publish error: {e}")
        await asyncio.sleep(5)
