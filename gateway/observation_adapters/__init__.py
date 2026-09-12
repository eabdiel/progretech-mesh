from __future__ import annotations

import os

from .base import ObservationAdapter
from .jsonl import JsonlObservationAdapter
from .null import NullObservationAdapter


def build_observation_adapter() -> ObservationAdapter:
    requested = os.environ.get("MESH_OBSERVATION_ADAPTER", "none").strip().lower()

    if requested == "jsonl":
        return JsonlObservationAdapter()

    return NullObservationAdapter()
