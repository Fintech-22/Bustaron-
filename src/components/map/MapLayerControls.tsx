import { layerDefinitions } from '../../data/mockData';
import type { LayerDefinition, LayerId } from '../../types/domain';

interface MapLayerControlsProps {
  activeLayers: Record<LayerId, boolean>;
  onToggleLayer: (layer: LayerId) => void;
}

export function MapLayerControls({ activeLayers, onToggleLayer }: MapLayerControlsProps): JSX.Element {
  return (
    <div className="layer-controls" role="group" aria-label="Map layer controls">
      {layerDefinitions.map((layer: LayerDefinition): JSX.Element => (
        <button
          key={layer.id}
          type="button"
          className="layer-toggle"
          aria-pressed={activeLayers[layer.id]}
          title={layer.description}
          onClick={() => onToggleLayer(layer.id)}
        >
          <span aria-hidden="true">{activeLayers[layer.id] ? '●' : '○'}</span>
          {layer.label}
        </button>
      ))}
    </div>
  );
}
