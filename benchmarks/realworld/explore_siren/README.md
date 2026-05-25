# Siren
Original notebook from
[Github](https://github.com/vsitzmann/siren/blob/master/explore_siren.ipynb)

## Modification made to the original notebook as the baseline
- downsize `total_steps` from `500`/`1000` to `10` for image fitting, audio fitting and Poisson equation
- downsize `hidden_features` for Siren class from `256` to `16`
## Modification
**ipyflow** \
1. run all (cell 1-22)
2. Direct assignment(m1): ipyflow rerun cell 1, 2, 5-17, 19, 21, 22.
    ```python
    # original cell 7
    optim = torch.optim.Adam(lr=1e-4, params=img_siren.parameters())
    
    # modified 
    optim = torch.optim.Adam(lr=1e-3, params=img_siren.parameters())
    ```
    Overly conservative. Only need to rerun cell 6 (re-init imgsiren), 7 (re-fit imgsiren), 9 (re-visualize of trained img_siren).
3. Direct assignment(m2):ipyflow rerun cell 1, 2, 4-17, 19, 21, 22.
    ```python
    # original cell 4
    Normalize(torch.Tensor([0.5]), torch.Tensor([0.5]))
    
    # modified  
    Normalize(torch.Tensor([0.0]), torch.Tensor([1.0]))
    ```
    Overly conservative. Only need ImageFitting and PoissonEqn related training: 6, 7, 9, 17, 19, where re-fitting audiosiren is not necessary and redefining class (cell 5 and 16) is also unnecessary since Python resolves updated `get_cameraman_tensor` at call time.
4. Direct assignment(m3): ipyflow rerun cell 1, 2, 5-17, 19, 21, 22
    ```python
    # original cell 2
    class Siren(nn.Module):
        def __init__(..., first_omega_0=30):
            ...

    # modified
    class Siren(nn.Module):
        def __init__(..., first_omega_0=60):
            ...
    ```

    Overly conservative. Rerun that is unnecessary: 1(library import), 5(ImageFitting def), 8(sines plot), 10(wavfile import), 11(AudioFile class), 16(PoissonEqn class that does not use Siren) + cell 12 where the default init value for `first_omega_0` is not used plus its downstream dependencies cell 13-15. 
5. Mutation(m4): ipyflow does not rerun any cells (but seems to rerun all after I rerun the same cell 3 times)
    ```python
    # Perturb trained weights to probe loss landscape
    with torch.no_grad():
        for p in img_siren.parameters():
            p.add_(torch.randn_like(p) * 0.05)
    ```