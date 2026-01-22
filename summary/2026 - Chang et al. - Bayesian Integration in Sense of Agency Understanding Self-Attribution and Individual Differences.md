### 1.  Background – Why the Review Was Needed and What Is Missing  

The sense of agency—the felt experience of being the author of one’s own actions—has been studied for decades, yet researchers have repeatedly hit two roadblocks.  

1. **Theoretical confusion** – Classic accounts (e.g., the comparator model, efference‑copy theories) treat agency as the outcome of a *single* comparison between predicted and actual sensory feedback.  Later work stresses that we actually monitor *many* cues at once—proximal kinesthetic signals, distal visual or proprioceptive outcomes, and even meta‑cognitive beliefs about other agents.  The literature therefore contains competing “one‑cue” versus “many‑cue” narratives, and it is unclear whether these can be reconciled under a single computational principle.  

2. **Empirical gap** – Early behavioral studies observed large, stable individual differences in agency judgments (e.g., some people are hypersensitive to small timing errors, others rely more on outcome magnitude), but no unified quantitative framework explained *where* those differences come from.  Consequently, the field lacked a way to link the observed variability to underlying cognitive or neuro‑biological mechanisms, especially in clinical populations where agency disturbances are hallmark symptoms (e.g., schizophrenia).  

The authors argue that what is missing is **a single, probabilistic model that (a) jointly handles multiple cues, (b) treats each cue’s *precision* as the source of individual differences in sensitivity, and (c) embeds a *prior* that can modulate the decision criterion**.  By introducing a Bayesian cue‑integration framework, the paper seeks to provide that missing unifying account.

---

### 2.  Section‑by‑Section Walk‑Through  

Below each major heading is unpacked as if a mentor were reading it aloud with you, pausing to clarify concepts that often trip up newcomers.

#### **2.1 Introduction – Mapping Multiple Feedback Streams onto a Unified Computational Principle**  

- **Problem stated** – After an action, our brain receives *many* pieces of evidence (e.g., the direction your arm moved, whether the target was hit, how long it took).  These can be parsed into *proximal* cues (immediate sensorimotor signals) and *distal* cues (external consequences such as “the ball landed on the target”).  Traditional models isolate either proximal *or* distal feedback, leaving a puzzle: **how does the system combine them**, and why do different people rely on them differently?  

- **Why introduce this now?** – Recent advances in *Bayesian causal inference* (e.g., Legaspi & Toyoizumi, 2019) show that when multiple sensory sources are available, the brain can treat them as *evidence* about a hidden cause (here, “self‑caused” vs “other‑caused”).  The authors point out that those advances have not yet been integrated with agency research.  

- **Key hidden assumption** – The brain is assumed to *represent* each cue’s reliability (precision) in a probabilistic format.  This is a *commitment* to a statistical view of perception rather than a purely symbolic or rule‑based view.  

- **Bridge to next sections** – By positing a probabilistic representation, the authors set the stage for a concrete mathematical model that will later be fitted to behavior (Section 4).  The rest of the introduction outlines three competing hypotheses (additive heuristics, fixed‑weight heuristics, signal‑detection style) that will serve as benchmarks.

#### **2.2 Theoretical Framework – Bayesian Integration of Multiple Cues**  

The core derivation is a **posterior probability** that an observed sensory cue originates from one’s own action:  

\[
P(H = \text{self}\mid D_1,D_2)=\sigma\!\bigl(\alpha D_{\text{int}} + \beta\bigr)
\]

where  

- \(D_1\) and \(D_2\) are two independent sensory inputs (e.g., proximal error, distal error).  
- \(\sigma(x)=\frac{1}{1+e^{-x}}\) is the logistic (sigmoid) link that maps a log‑likelihood to a probability.  
- \(D_{\text{int}} = w D_1 + (1-w) D_2\) is an *internal* weighted sum; \(w\) is a free parameter that controls how much weight is given to the proximal cue.  
- \(\alpha\) and \(\beta\) are *slope* and *bias* parameters that capture overall sensitivity and a decision criterion.  

**Why this equation matters:**  
- It embodies **reliability‑weighted integration**—the term “precision” of each cue is implicitly represented by the variance of its likelihood distribution (see below).  
- The logistic transform ensures the posterior stays within \([0,1]\) while allowing a *continuous* blend of cues rather than an all‑or‑nothing rule.  

**Explicit cue‑likelihoods**  

Each cue is modeled as a **Gaussian likelihood** under the self‑hypothesis:  

\[
P(D\mid H=\text{self}) = \frac{1}{\sigma\sqrt{2\pi}}\,
\exp\!\Bigl[-\frac{(D-\mu)^2}{2\sigma^2}\Bigr]
\]

In the experimental paradigm \(\mu=0\) because the *expected* prediction error is zero; thus the shape of the likelihood is solely controlled by its **standard deviation \(\sigma\)**.  A *larger* \(\sigma\) means the cue is *noisier* (lower precision), so the model will automatically down‑weight it when computing the posterior.  

**Link to individual differences**  

- **Sensitivity**: The width of the likelihood (i.e., \(\sigma\)) determines how steeply the posterior changes with cue magnitude.  A small \(\sigma\) => a steep change => high sensitivity to that cue.  
- **Criterion**: The bias term \(\beta\) shifts the logistic curve left or right, reflecting a personal tendency to attribute an outcome to self regardless of the evidence.  

#### **2.3 Model Specification – From Theory to Testable Predictions**  

1. **Cue definitions**  
   - *Proximal error* (\(D_p\)): angular deviation between the joystick direction and the actual launch vector (range 0‑40°).  
   - *Distal error* (\(D_d\)): angular deviation between the launched trajectory and the target centre (range 0‑20°).  

2. **Likelihoods under the “other” hypothesis**  
   - Instead of a Gaussian, the authors assume a **uniform distribution** over the feasible cue range under the “other” cause, i.e.,  
     \[
     P(D\mid H=\neg\text{self}) = 
     \begin{cases}
     \frac{1}{b-a}, & \text{if } D\in[a,b] \\
     0, & \text{otherwise}
     \end{cases}
     \]
   - This reflects the idea that *any* non‑self cause could produce a wide variety of errors, whereas the self‑cause is constrained by the organism’s internal model.  

3. **Prior belief \(P(H=\text{self})\)**  
   - Treated as a free parameter (often biased toward self because participants generally feel some control).  
   - The authors propose that a *strong prior* can compensate for weak sensory evidence (e.g., high \(\sigma\)).  

4. **Decision rule**  
   - The posterior computed via Bayes’ rule is passed through a *sigmoid* to map onto a continuous agency rating (0 = no control, 1 = full control).  

#### **2.4 Alternative Models – Benchmarks for Comparison**  

To establish the *incremental* explanatory power of the Bayesian integration model, three simpler heuristics were built:

| Model | Core Assumption | Mathematical Form |
|-------|----------------|-------------------|
| **Additive Logistic** | Cues summed linearly before logistic transform | \(P=\sigma(\beta_0 + \beta_1 D_p + \beta_2 D_d)\) |
| **Fixed‑Weight Integration** | One cue gets a *fixed* weight \(w\); the other weight is \(1-w\) | \(P=\sigma(\beta_0 + w D_p + (1-w) D_d)\) |
| **Signal‑Detection Theory (SDT)** | Internal decision variable compared to a criterion | \(P=\Phi\!\bigl(\frac{w D_p + (1-w) D_d - c}{s}\bigr)\) |

*Why these matter*: they each embody a distinct theoretical commitment (e.g., “all cues are added”, “the brain uses a fixed weighting”, “a threshold decision”).  The Bayesian model is not just more flexible; it *explains* flexibility by letting both sensitivity (\(\sigma\)) and criterion (\(\beta\)) vary across participants.

#### **2.5 Experimental Design – From Theory to Data**  

- **Experiment 1 (Agency judgment)**  
  - Participants launched a dot toward a *moving* target using a joystick.  
  - Two orthogonal error dimensions were manipulated: **proximal error** (joystick‑to‑launch angle) and **distal error** (launch‑to‑target angle).  
  - After each trial participants rated agency on a 0‑1 continuous scale.  

- **Experiment 2 (Motor control performance)**  
  - A *static* shooting task measured how precisely participants could produce a given proximal error when they truly controlled the joystick (no algorithmic bias).  
  - This provides an empirical estimate of the *likelihood variance* (\(\sigma\)) for the proximal cue in a “self‑controlled” context.  

- **Key operational link**  
  - If a participant’s \(\sigma_{\text{prox}}\) is small (i.e., they produce very consistent proximal errors), the Bayesian model predicts *high weight* on that cue in agency judgments.  Conversely, a large \(\sigma\) should lead to lower weight and consequently a heavier reliance on the distal cue or on the prior.  

#### **2.6 Results – How Individual Differences Emerge**  

- **Cue weighting across participants**  
  - A linear mixed‑effects model showed a *negative correlation* between the slopes assigned to proximal and distal cues (≈ –0.80).  In plain language: participants who trusted the proximal cue **relied less** on the distal cue, and vice‑versa.  

- **Motor performance ↔ cue weighting**  
  - The fitted \(\sigma\) from the static shooting task *positively* correlated with the weight placed on proximal errors in agency judgments (r ≈ 0.39, p = 0.03).  Thus, participants with *more stable* (low‑variance) motor output were *more sensitive* to proximal errors when deciding how much control they felt.  

- **Model‑fitting performance**  
  - The Bayesian model yielded the smallest **RMSE**, highest **\(R^2\)**, and the lowest **AIC/BIC** among the four candidate models.  Cross‑validated negative log‑likelihood also favored it, indicating that it captured not just average trends but the *fine‑grained trial‑by‑trial* pattern of agency ratings.  

- **Parameter‑behavior relations**  
  - \(\sigma_1\) (the precision of proximal error) correlated with participants’ *sensitivity* to proximal cues, whereas \(\sigma_2\) correlated with sensitivity to distal cues.  
  - The estimated *prior belief* in self correlated with the *criterion* measured separately (average agency rating), confirming the hypothesized separation: **sensitivity ≈ likelihood precision**, **criterion ≈ prior**.  

#### **2.7 Model Simulation – Linking Parameters to Psychopathology**  

- By reducing the precision of the sensorimotor likelihood (\(\sigma\)) while keeping the prior high, the model reproduced a pattern akin to **excessive self‑attribution** seen in schizophrenia: participants would attribute outcomes to themselves even when evidence was weak.  
- Conversely, lowering the prior while increasing \(\sigma\) simulated the *loss of agency* observed in some patients (they fail to attribute successes to themselves).  

#### **2.8 Discussion – What the Review Contributes**  

- **Re‑framing the Core Question** – Instead of asking “Which cue dominates?” the authors ask “How does the brain compute the *probability* that each cue arose from self‑generated action, and how does that probability guide feeling of control?”  

- **Synthesis of Prior Work** – They integrate (i) causal‑inference perspectives on agency, (ii) reliability‑weighted cue integration from multisensory perception, and (iii) prior‑based decision criteria from metacognitive research.  

- **Empirical Implications** –  
  - Individual differences are *theoretically* rooted in two orthogonal dimensions: (a) **likelihood precision** (how clean the sensory signal is), and (b) **prior bias** (how liberal or conservative the personal rule is).  
  - This separation predicts testable signatures: e.g., clinical groups should show either higher \(\sigma\) (noisy input) or altered priors, or both.  

- **Future Directions** – The authors explicitly call for (i) larger samples with broader motor‑performance variability, (ii) longitudinal designs to test test–retest reliability of the estimated parameters, and (iii) application of the model to clinical populations to see whether the simulated profiles match observed symptom patterns.  

---

### 3.  Common Points of Confusion & How to Navigate Them  

| Issue | Why it feels confusing | How to reinterpret it |
|-------|------------------------|-----------------------|
| **“Proximal vs distal” terminology** | The same word is used in motor control (proximal = near), but here it labels *different informational sources* (immediate sensorimotor error vs later outcome error). | Think of “proximal” as the *first‑hand* cue (what your body feels) and “distal” as the *third‑hand* cue (what you observe externally). |
| **\(D_{\text{int}} = w D_1 + (1-w) D_2\)** | The notation hides the *interpretive* meaning of \(w\). | \(w\) is simply the **weight** assigned to cue 1; the brain does *not* literally add the numbers, it *blends* them according to how reliable each cue is. |
| **Uniform likelihood under “other”** | Uniform distributions feel arbitrary; why not also Gaussian? | The uniform reflects the assumption that *any* non‑self cause can generate a wide range of errors equally likely—there is no a‑priori “expected” non‑self error magnitude. |
| **Logit link \(\sigma(\cdot)\)** | Logistic function may look like a “black box”. | It merely squashes any real‑valued score into the 0–1 interval, preserving the *relative ordering* of evidence while ensuring interpretability as a probability. |
| **Interpretation of \(\beta\) as “criterion”** | In SDT, a criterion is a *threshold*; here it is embedded in a logistic slope. | Think of \(\beta\) as a *bias* that shifts the whole decision surface left/right—higher \(\beta\) means you need *less* evidence to attribute an outcome to self. |
| **Correlation between \(\sigma\) and cue weighting** | Correlation does not equal causation; the model assumes a *causal* mapping. | The model *derives* the weight from \(\sigma\) mathematically; a larger \(\sigma\) mathematically reduces the contribution of that cue to the posterior, which is why you see a correlation in the data. |

---

### 4.  Take‑Home Message (Conclusion)  

- **New perspective** – Agency is best understood as a *probabilistic inference* problem: the brain continuously evaluates how plausible it is that a set of sensory cues were generated by an *internal* cause versus an *external* cause, and it does so in a way that respects each cue’s *precision*.  

- **Reshape of the field** – By treating sensitivity and criterion as *separate, estimable parameters* (σ and β), the review provides a concrete roadmap for linking behavioral variability to underlying neuro‑computations.  This reframes debates that once hinged on “which cue dominates” into questions about *how reliable* those cues are for each individual and *how biased* their priors happen to be.  

- **Implicit calls for future work** –  
  1. **Empirically**: Validate the σ‑β separation in clinical groups (e.g., schizophrenia, obsessive‑compulsive disorder) and test whether parameter patterns predict symptom severity.  
  2. **Theoretically**: Extend the model to more than two cues, to hierarchical cues (e.g., meta‑cues about confidence), and to dynamic priors that can be updated trial‑by‑trial.  
  3. **Methodologically**: Collect larger, more heterogeneous samples to improve estimates of the likelihood variances, especially for distal cues that often have limited dynamic range.  

In short, the article supplies **the first mathematically precise, computationally instantiated account of how multiple sensory streams are combined to generate the felt sense of agency, and it shows how individual differences in that combination can be captured by just a handful of interpretable parameters**.  It thus opens a fertile valley where computational modeling, cognitive neuroscience, and clinical psychiatry can meet.  

---  

*Feel free to pause at any equation or phrase and ask for a deeper “why does this make sense?” walk‑through; we can unpack the derivation step‑by‑step or discuss how it would look in a Bayesian network diagram.*