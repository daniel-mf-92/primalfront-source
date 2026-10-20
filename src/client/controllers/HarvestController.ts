/**
 * HarvestController — click-to-harvest for wood/rock resource nodes (Module §4).
 *
 * Subscribes to MouseUpEvent (mirroring WarshipSelectionController /
 * BuildPreviewController) and, when the click lands on a resource node the
 * local player can harvest, emits SendHarvestIntentEvent. The server's
 * HarvestExecution is authoritative and re-validates ownership/adjacency and
 * rejects animal packs — the check here is purely a UX pre-filter.
 *
 * NOT clobbering the normal left-click flow:
 *  - Honors the same `uiState.ghostStructure !== null` gate that
 *    ClientGameRunner.inputEvent uses: while a build ghost is active, clicks are
 *    build placements, never harvests.
 *  - No-op during the spawn phase (spawn clicks own that flow).
 *  - Fires ONLY on a tile the player ALREADY OWNS. Own tiles can never trigger
 *    an attack (`canAttack` returns false for self-owned tiles) or a
 *    wilderness-expansion, so harvesting an owned node never double-fires with
 *    the attack/spawn/expand path in ClientGameRunner. (The server still accepts
 *    the broader "owned OR diag-adjacent" rule for non-click triggers; the click
 *    pre-filter is deliberately the stricter, collision-free subset.)
 *  - Does nothing when the clicked tile has no resource node, so ordinary
 *    clicks on bare territory fall straight through to the existing handlers.
 */

import { EventBus } from "../../core/EventBus";
import { Age, ResourceKind } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { Controller } from "../Controller";
import { MouseUpEvent } from "../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { SendHarvestIntentEvent } from "../Transport";
import { UIState } from "../UIState";
import { GameView } from "../view";

export class HarvestController implements Controller {
  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private uiState: UIState,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
  }

  private onMouseUp(event: MouseUpEvent): void {
    // A build ghost owns the click — don't harvest underneath a placement.
    if (this.uiState.ghostStructure !== null) return;
    // Spawn-phase clicks belong to the spawn flow.
    if (this.game.inSpawnPhase()) return;

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;
    if (myPlayer.age() === Age.Primitive) return;

    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const tile: TileRef = this.game.ref(cell.x, cell.y);

    // Only act on a real resource node.
    const node = this.game.resourceAt(tile);
    if (node.kind === ResourceKind.None || node.quantity <= 0) return;

    // Click pre-filter: only the player's OWN tiles (collision-free with the
    // attack/expand/spawn flow). The server allows owned-or-adjacent.
    if (this.game.ownerID(tile) !== myPlayer.smallID()) return;

    this.eventBus.emit(new SendHarvestIntentEvent(tile));
  }
}
