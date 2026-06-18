/** Facet plugin entry point. */
import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { FacetKey } from "./actions/facet-key";
import { bridge } from "./bridge";
import { controller } from "./controller";

streamDeck.logger.setLevel(LogLevel.DEBUG);

// Register the one action that fills every key.
streamDeck.actions.registerAction(new FacetKey());

// Wire context → keys before we start talking to either side.
controller.init();

// Reconnect to the add-in promptly after the machine wakes.
streamDeck.system.onSystemDidWakeUp(() => bridge.kick());

streamDeck.connect().then(() => {
	// Start hunting for the SolidWorks add-in's WebSocket server.
	bridge.start();
	streamDeck.logger.info("Facet plugin connected to Stream Deck; bridging to SolidWorks…");
});
