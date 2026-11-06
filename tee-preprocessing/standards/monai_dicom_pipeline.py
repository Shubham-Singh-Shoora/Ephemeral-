"""DICOM PS3.15-oriented identifier scrubbing and MONAI volume preparation."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np


IDENTIFYING_TAGS = {
    "InstitutionName", "InstitutionAddress", "ReferringPhysicianName",
    "StationName", "StudyDescription", "SeriesDescription",
    "OperatorsName", "AdmittingDiagnosesDescription",
}


def scrub_dataset(dataset):
    """Remove patient-group tags and selected identifying study metadata in place."""
    for element in list(dataset.iterall()):
        if element.tag.group == 0x0010 or element.keyword in IDENTIFYING_TAGS:
            if element.tag in dataset:
                del dataset[element.tag]
    dataset.remove_private_tags()
    return dataset


def prepare_dicom_series(paths: Iterable[str | Path], target_spacing=(1.5, 1.5, 1.5)) -> np.ndarray:
    """Load, scrub, rescale, resample, and intensity-normalize a DICOM series."""
    try:
        import pydicom
        from scipy.ndimage import zoom
        from monai.transforms import ScaleIntensityRangePercentiles
    except ImportError as exc:
        raise RuntimeError("DICOM/MONAI dependencies are required for deep_vision_monai") from exc

    datasets = [scrub_dataset(pydicom.dcmread(str(path))) for path in paths]
    if not datasets:
        raise ValueError("At least one DICOM instance is required")
    datasets.sort(key=lambda item: float(getattr(item, "ImagePositionPatient", [0, 0, 0])[2]))
    slices = []
    for item in datasets:
        pixels = item.pixel_array.astype(np.float32)
        slope = float(getattr(item, "RescaleSlope", 1.0))
        intercept = float(getattr(item, "RescaleIntercept", 0.0))
        slices.append(pixels * slope + intercept)
    volume = np.stack(slices, axis=0)
    pixel_spacing = [float(value) for value in getattr(datasets[0], "PixelSpacing", [1.0, 1.0])]
    slice_spacing = float(getattr(datasets[0], "SpacingBetweenSlices", getattr(datasets[0], "SliceThickness", 1.0)))
    factors = (
        slice_spacing / target_spacing[0],
        pixel_spacing[0] / target_spacing[1],
        pixel_spacing[1] / target_spacing[2],
    )
    resampled = zoom(volume, factors, order=1)
    transform = ScaleIntensityRangePercentiles(0.5, 99.5, b_min=0.0, b_max=1.0, clip=True)
    return np.asarray(transform(resampled), dtype=np.float32)
