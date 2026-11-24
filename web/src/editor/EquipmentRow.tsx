/**
 * @module web/src/editor/EquipmentRow
 * One equipment line in the editor (3b, as the wireframes have it): the
 * item, picked from the shared equipment list or created on the spot, with
 * a ⋮ menu (Move up, Move down, Remove line); then how many, with − and +,
 * and whether the recipe works without it.
 */

import { LIMITS } from '../../../shared/limits';
import { Menu } from '../components/Menu';
import { equipmentErrorKey, type DraftAction, type DraftErrors, type EquipmentDraft } from './draft';
import { SharedListPicker } from './SharedListPicker';
import styles from './Editor.module.css';

interface EquipmentRowProps {
    line: EquipmentDraft;
    index: number;
    count: number;
    errors: DraftErrors;
    dispatch: (action: DraftAction) => void;
    onRemove: (line: EquipmentDraft) => void;
}

export function EquipmentRow({ line, index, count, errors, dispatch, onRemove }: EquipmentRowProps) {
    const n = index + 1;
    const itemError = errors[equipmentErrorKey(line.key, 'item')];
    const quantityError = errors[equipmentErrorKey(line.key, 'quantity')];
    const errorId = `equipment-${line.key}-item-error`;
    const { min, max } = LIMITS.equipmentQuantity;
    const setQuantity = (quantity: number) => dispatch({ type: 'equipment', key: line.key, patch: { quantity } });

    return (
        <li className={`${styles.line} ${itemError || quantityError ? styles.lineInvalid : ''}`}>
            <div className={styles.lineRow}>
                <SharedListPicker
                    list="equipment"
                    label={`Item, equipment line ${n}`}
                    placeholder="Item, like large pan"
                    text={line.itemText}
                    picked={line.item}
                    error={itemError}
                    errorId={errorId}
                    autoFocus={line.focus}
                    newHint="New: it's added to the equipment list when this recipe reaches the server."
                    onTextChange={(text) => dispatch({ type: 'equipmentText', key: line.key, text })}
                    onPick={(item) =>
                        dispatch({ type: 'equipment', key: line.key, patch: { item: { id: item.id, name: item.name }, itemText: item.name } })
                    }
                />
                <Menu
                    label={`Options for equipment line ${n}`}
                    buttonClassName={styles.lineMenu}
                    items={[
                        {
                            label: 'Move up',
                            disabled: index === 0,
                            onSelect: () => dispatch({ type: 'moveEquipment', key: line.key, by: -1 }),
                        },
                        {
                            label: 'Move down',
                            disabled: index === count - 1,
                            onSelect: () => dispatch({ type: 'moveEquipment', key: line.key, by: 1 }),
                        },
                        { label: 'Remove line', danger: true, onSelect: () => onRemove(line) },
                    ]}
                />
            </div>
            {itemError && (
                <p id={errorId} className={styles.error}>
                    {itemError}
                </p>
            )}
            <div className={styles.equipmentTools}>
                <div role="group" aria-label={`How many, equipment line ${n}`} className={styles.stepper}>
                    <button
                        type="button"
                        className={styles.stepperButton}
                        aria-label="One fewer"
                        disabled={line.quantity <= min}
                        onClick={() => setQuantity(Math.max(min, line.quantity - 1))}
                    >
                        −
                    </button>
                    <span className={styles.stepperValue}>{line.quantity}</span>
                    <button
                        type="button"
                        className={styles.stepperButton}
                        aria-label="One more"
                        disabled={line.quantity >= max}
                        onClick={() => setQuantity(Math.min(max, line.quantity + 1))}
                    >
                        +
                    </button>
                </div>
                <label className={styles.optional}>
                    <input
                        type="checkbox"
                        // Named for its line, the same in every browser: hidden text inside a label is read with a stray space
                        aria-label={`Optional, equipment line ${n}`}
                        checked={line.optional}
                        onChange={(event) => dispatch({ type: 'equipment', key: line.key, patch: { optional: event.target.checked } })}
                    />
                    Optional
                </label>
            </div>
            {quantityError && <p className={styles.error}>{quantityError}</p>}
        </li>
    );
}
