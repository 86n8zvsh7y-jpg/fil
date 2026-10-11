# fil

Une barre au-dessus de la zone de saisie de Claude. Elle montre en direct :

- le temps écoulé de la tâche, avec une barre de progression horizontale
- les étapes en cours et leur durée
- chaque sous-agent (type, description, durée, étapes, état), même en parallèle

La barre passe au vert quand la tâche est terminée et reste visible jusqu'à la demande suivante. Le bouton **Fermer** la masque.

S'affiche dans le terminal et l'application de bureau.

## Installation

Dans une session Claude Code ouverte dans un terminal :

```
/plugin install fil --marketplace <ton-pseudo-github>/<nom-du-depot>
```

Réponds `y` pour ajouter le marketplace, puis choisis la portée « user » pour l'avoir dans toutes tes sessions.
