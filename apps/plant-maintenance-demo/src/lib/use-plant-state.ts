"use client";

import { useEffect, useState } from "react";

import { readPlantState, subscribeToStateChanges, type PlantStateRead } from "./maintenance-store";

export function usePlantState(): PlantStateRead | null {
  const [read, setRead] = useState<PlantStateRead | null>(null);

  useEffect(() => {
    const update = () => setRead(readPlantState());
    update();
    return subscribeToStateChanges(update);
  }, []);

  return read;
}
